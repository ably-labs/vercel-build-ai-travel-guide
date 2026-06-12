import { anthropic } from "@ai-sdk/anthropic";
import { Invocation, type InvocationData } from "@ably/ai-transport";
import { createAgentSession } from "@ably/ai-transport/vercel";
import { convertToModelMessages, stepCountIs, streamText, tool } from "ai";
import Ably from "ably";
import { after } from "next/server";
import { z } from "zod";

import { pinsChannelName, tripIdFromSessionChannel } from "@/lib/channels";
import type { Destination } from "@/lib/trip-state";
import { TripStateWriter } from "@/lib/trip-state-server";

export const runtime = "nodejs";
// The response returns immediately, but after() keeps streaming the AI
// response over Ably — give it room to finish.
export const maxDuration = 300;

const SYSTEM_PROMPT = `You are Wayfarer, an expert AI travel planner. You work
on a shared visual canvas: a map, a day-by-day board, and a budget tracker.
The canvas — not the chat — is where the plan lives.

Plans must be grounded in reality. Before writing a plan to the canvas, use
web_search to find real, currently-operating places: specific named hotels,
restaurants, attractions and tours, where they are, what they cost, and when
they open. A few searches per destination is enough — don't search per stop.
Never invent a venue; if search turns up nothing for an idea, pick a real
alternative it did turn up.

When the user asks you to plan (or extend) a trip, you MUST write the plan to
the canvas using the tools, in this order:
1. set_trip_meta — once, with a short trip title.
2. add_destination — one per city/place visited, with accurate coordinates.
3. add_day — one per day of the trip, in order.
4. add_stop — every concrete item (flights, hotels, activities, meals,
   sights, transport) goes on a day as a stop, with a realistic indicative
   price in whole US dollars (0 for free things) and precise coordinates of
   where it happens, so it appears on the map. Add stops to a day only
   after creating that day.

Keep your chat replies short and conversational — a sentence or two of
rationale and any assumptions. Never repeat the full itinerary in prose; it's
already on the canvas. Make sensible assumptions rather than asking more than
one clarifying question.`;

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "item"
  );
}

function buildTools(
  writer: TripStateWriter,
  announcePin: (destination: Destination) => void,
) {
  return {
    set_trip_meta: tool({
      description:
        "Set the trip's title and one-line summary, shown in the canvas header.",
      inputSchema: z.object({
        title: z.string().describe("Short trip title, e.g. 'Lisbon Long Weekend'"),
        summary: z.string().optional().describe("One-line trip summary"),
      }),
      execute: async ({ title, summary }) => {
        await writer.setMeta({ title, summary });
        return { ok: true };
      },
    }),
    add_destination: tool({
      description:
        "Add a destination (city or place visited on the trip) to the map.",
      inputSchema: z.object({
        name: z.string(),
        country: z.string().optional(),
        lat: z.number().describe("Latitude in decimal degrees"),
        lng: z.number().describe("Longitude in decimal degrees"),
      }),
      execute: async ({ name, country, lat, lng }) => {
        const destination = { id: slug(name), name, country, lat, lng };
        await writer.addDestination(destination);
        announcePin(destination);
        return { destinationId: destination.id };
      },
    }),
    add_day: tool({
      description:
        "Add a day to the itinerary board. Days must be created before stops can be added to them. Returns the dayId to use with add_stop.",
      inputSchema: z.object({
        index: z.number().int().min(1).describe("Day number, starting at 1"),
        title: z.string().describe("Day heading, e.g. 'Day 1 — Alfama & the castle'"),
        date: z.string().optional().describe("ISO date if known, e.g. 2026-07-18"),
      }),
      execute: async ({ index, title, date }) => {
        const dayId = `day-${index}`;
        await writer.addDay(dayId, index, title, date);
        return { dayId };
      },
    }),
    add_stop: tool({
      description:
        "Add a stop (booking, activity, meal, flight, hotel...) to an existing day on the board. Priced stops update the trip budget automatically.",
      inputSchema: z.object({
        dayId: z
          .string()
          .regex(/^day-\d+$/)
          .describe("The dayId returned by add_day"),
        name: z.string().describe("What it is, e.g. 'TAP flight LHR→LIS'"),
        kind: z.enum(["flight", "hotel", "activity", "food", "transport", "sight"]),
        time: z.string().optional().describe("24h start time, e.g. 09:30"),
        location: z.string().optional().describe("Venue name or address"),
        lat: z
          .number()
          .describe(
            "Latitude in decimal degrees of where the stop takes place (departure point for flights/transport)",
          ),
        lng: z.number().describe("Longitude in decimal degrees"),
        price: z.number().min(0).optional().describe("Indicative price in whole USD"),
        notes: z.string().optional(),
      }),
      execute: async ({ dayId, name, kind, time, location, lat, lng, price, notes }) => {
        const id = `${slug(name)}-${Math.random().toString(36).slice(2, 6)}`;
        await writer.addStop(dayId, {
          id,
          name,
          kind,
          time,
          location,
          lat,
          lng,
          price,
          notes,
        });
        return { stopId: id };
      },
    }),
    web_search: anthropic.tools.webSearch_20250305({ maxUses: 8 }),
  };
}

// AI Transport agent endpoint. The client's ChatTransport POSTs an invocation
// here to wake the agent; the user's message is already on the Ably channel.
// We load the conversation from channel history, run the model, and stream
// the response back over the same channel (not the HTTP response body) while
// the tools write the structured plan into the trip's LiveObjects state.
export async function POST(req: Request) {
  const ablyApiKey = process.env.ABLY_API_KEY;
  if (!ablyApiKey) {
    return Response.json({ error: "ABLY_API_KEY not configured" }, { status: 500 });
  }

  const data = (await req.json()) as InvocationData;
  const invocation = Invocation.fromJSON(data);

  // Only serve well-formed trip session channels.
  const tripId = tripIdFromSessionChannel(invocation.sessionName);
  if (!tripId) {
    return Response.json({ error: "Invalid session name" }, { status: 400 });
  }

  const ably = new Ably.Realtime({ key: ablyApiKey });
  const session = createAgentSession({
    client: ably,
    channelName: invocation.sessionName,
  });
  await session.connect();

  const run = session.createRun(invocation, { signal: req.signal });
  await run.start();

  // Full multi-turn history, reconstructed from the channel — the channel is
  // the conversation record; there is no database.
  const messages = await run.loadConversation();

  const writer = new TripStateWriter(tripId, ablyApiKey);
  await writer.ensureInitialized();

  // Pin events are a fire-and-forget animation signal for the map; the
  // durable destination is already in LiveObjects, so a lost event must not
  // fail the tool call.
  const pinsChannel = ably.channels.get(pinsChannelName(tripId));
  const announcePin = (destination: Destination) => {
    pinsChannel.publish("pin", destination).catch((error) => {
      console.error("Pin event publish failed:", error);
    });
  };

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: buildTools(writer, announcePin),
    stopWhen: stepCountIs(32),
    abortSignal: run.abortSignal,
  });

  // Stream the response over Ably after the HTTP response returns.
  after(async () => {
    try {
      const { reason } = await run.pipe(result.toUIMessageStream());
      await run.end(reason);
    } catch (error) {
      console.error("AI run failed:", error);
      await run.end("error").catch(() => {});
    } finally {
      session.close();
      ably.close();
    }
  });

  return new Response(null, { status: 200 });
}
