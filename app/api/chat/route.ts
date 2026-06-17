import { anthropic } from "@ai-sdk/anthropic";
import { Invocation, type InvocationData } from "@ably/ai-transport";
import { createAgentSession } from "@ably/ai-transport/vercel";
import { convertToModelMessages, stepCountIs, streamText, tool } from "ai";
import Ably from "ably";
import { after } from "next/server";
import { z } from "zod";

import { pinsChannelName, tripIdFromSessionChannel } from "@/lib/channels";
import { sanitizeConversation } from "@/lib/sanitize-conversation";
import { MAX_ITINERARY_ITEMS, type Destination } from "@/lib/trip-state";
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

Alongside the scheduled plan, use suggest_landmark to drop a handful of
notable nearby points of interest (well-known sights, viewpoints, museums)
that aren't on the itinerary — optional ideas the traveller might add. These
are not stops: they don't count against the itinerary cap, aren't placed on a
day, and don't affect the budget. They surface as pins on the map when the
user zooms in on a destination. A few real, highly-rated ones per destination
is plenty; don't suggest somewhere already on the itinerary as a stop.

Keep the plan tight: a trip may contain at most ${MAX_ITINERARY_ITEMS}
itinerary items (stops) in total — this is a hard ceiling, not a target, so
shorter trips should have fewer. Do not over-stuff the schedule. When you
have more candidate stops than the cap allows, keep only the most popular,
highly-recommended, highest-signal ones (judged by your web_search grounding —
ratings, prominence, how often a place is recommended) and drop the niche or
filler ones; never pad just to reach ten. Add stops most-popular-first, and
spread the kept stops sensibly across the trip's days rather than cramming
them into day one. The add_stop tool enforces the ceiling and will refuse
once the plan is full, so choose what makes the cut before you add it.

When the user adjusts the plan's timeline — retiming a stop, moving things
between days, shifting the whole schedule, swapping or dropping items — you
MUST revise the existing canvas in place rather than adding duplicates:
1. get_schedule — read the current board to find the real dayIds and stopIds.
2. update_stop / move_stop / remove_stop — retime, reorder across days, or
   drop the affected stops. update_day re-titles or re-dates a day.
The board everyone is looking at updates live with each call, so make the
edits directly; never ask the user to refresh, and never re-add stops that
already exist.

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
    suggest_landmark: tool({
      description:
        "Suggest a notable landmark or point of interest near the trip's destinations. These appear as pins on the map when the user zooms in, as optional 'you could also see this' ideas — they are NOT scheduled onto a day and don't affect the budget. Use real, currently-open places with accurate coordinates. Re-suggesting the same landmark (same name) replaces it rather than duplicating.",
      inputSchema: z.object({
        name: z.string().describe("Landmark name, e.g. 'Belém Tower'"),
        lat: z.number().describe("Latitude in decimal degrees"),
        lng: z.number().describe("Longitude in decimal degrees"),
        blurb: z
          .string()
          .optional()
          .describe("One short line on why it's worth seeing"),
      }),
      execute: async ({ name, lat, lng, blurb }) => {
        const landmark = { id: slug(name), name, lat, lng, blurb };
        await writer.addLandmark(landmark);
        return { landmarkId: landmark.id };
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
        // Deterministic id from the day + name, so re-adding the same item to
        // the same day replaces it rather than creating a duplicate card (and
        // double-counting its price). Re-planning that re-issues add_stop for
        // an existing item is therefore idempotent.
        const nameSlug = slug(name);
        const id = `${dayId}-${nameSlug}`;
        // The same activity may already live on a *different* day (its id then
        // carries that day's prefix, so the same-day replace above wouldn't
        // catch it). Find any such prior copy and relocate it instead of
        // minting a second one, so an activity the user is already doing never
        // appears twice across the trip (AIT-951).
        const relocateFrom =
          (await writer.findStopByName(dayId, nameSlug)) ?? undefined;
        // Hard cap: a plan never holds more than MAX_ITINERARY_ITEMS stops.
        // The model is told to add the most popular stops first, so the items
        // retained at the cap are the highest-signal ones, not an arbitrary
        // slice. Refuse the call once full rather than truncating silently —
        // but allow replacing a stop that already exists (same id on this day,
        // or the same activity being relocated from another day), since
        // neither grows the plan.
        const existing = await writer.countStops();
        const isReplacement = (await writer.hasStop(dayId, id)) || relocateFrom != null;
        if (existing >= MAX_ITINERARY_ITEMS && !isReplacement) {
          return {
            error: `Itinerary is full: a plan may contain at most ${MAX_ITINERARY_ITEMS} stops, and this trip already has ${existing}. Do not add more stops. If a less important stop should make way for this one, remove it first with remove_stop, then re-add.`,
          };
        }
        const stopId = await writer.addStop(
          dayId,
          {
            id,
            name,
            kind,
            time,
            location,
            lat,
            lng,
            price,
            notes,
          },
          relocateFrom,
        );
        return { stopId };
      },
    }),
    get_schedule: tool({
      description:
        "Read the current day-by-day schedule from the canvas, including every stop's stopId, time, day and price. Call this before revising an existing plan so updates target real ids.",
      inputSchema: z.object({}),
      execute: async () => {
        const days = await writer.getSchedule();
        return { days };
      },
    }),
    update_stop: tool({
      description:
        "Revise an existing stop in place — change its time, name, price, location or notes. The shared day board updates live. Only provide the fields that change.",
      inputSchema: z.object({
        dayId: z
          .string()
          .regex(/^day-\d+$/)
          .describe("The day the stop is currently on"),
        stopId: z.string().describe("The stopId from add_stop or get_schedule"),
        name: z.string().optional(),
        kind: z
          .enum(["flight", "hotel", "activity", "food", "transport", "sight"])
          .optional(),
        time: z.string().optional().describe("New 24h start time, e.g. 14:00"),
        location: z.string().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        price: z
          .number()
          .min(0)
          .optional()
          .describe("New price in whole USD; the budget adjusts by the difference"),
        notes: z.string().optional(),
      }),
      execute: async ({ dayId, stopId, ...changes }) => {
        const updated = await writer.updateStop(dayId, stopId, changes);
        if (!updated) {
          return {
            error: `No stop '${stopId}' on ${dayId}. Call get_schedule to see current ids.`,
          };
        }
        return { ok: true, stop: updated };
      },
    }),
    move_stop: tool({
      description:
        "Move an existing stop to a different day (optionally retiming it in the same call). Atomic: the board never shows it twice. The target day must already exist.",
      inputSchema: z.object({
        fromDayId: z.string().regex(/^day-\d+$/),
        toDayId: z.string().regex(/^day-\d+$/),
        stopId: z.string().describe("The stopId from add_stop or get_schedule"),
        time: z
          .string()
          .optional()
          .describe("New 24h start time on the target day"),
      }),
      execute: async ({ fromDayId, toDayId, stopId, time }) => {
        const moved = await writer.moveStop(fromDayId, toDayId, stopId, {
          time,
        });
        if (!moved) {
          return {
            error: `No stop '${stopId}' on ${fromDayId}. Call get_schedule to see current ids.`,
          };
        }
        return { ok: true, stop: moved };
      },
    }),
    remove_stop: tool({
      description:
        "Remove a stop from the schedule. Its price is refunded from the trip budget.",
      inputSchema: z.object({
        dayId: z.string().regex(/^day-\d+$/),
        stopId: z.string().describe("The stopId from add_stop or get_schedule"),
      }),
      execute: async ({ dayId, stopId }) => {
        const removed = await writer.removeStop(dayId, stopId);
        if (!removed) {
          return {
            error: `No stop '${stopId}' on ${dayId}. Call get_schedule to see current ids.`,
          };
        }
        return { ok: true, removed: removed.name };
      },
    }),
    update_day: tool({
      description:
        "Re-title or re-date an existing day on the board, e.g. when the trip dates shift.",
      inputSchema: z.object({
        dayId: z.string().regex(/^day-\d+$/),
        title: z.string().optional(),
        date: z.string().optional().describe("New ISO date, e.g. 2026-07-19"),
      }),
      execute: async ({ dayId, title, date }) => {
        await writer.updateDay(dayId, { title, date });
        return { ok: true };
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
  const rawMessages = await run.loadConversation();
  // The reconstructed history can carry malformed tool calls that Anthropic
  // rejects with `messages.<n>.content.0.tool_use.input: Field required`: a
  // turn interrupted mid-call leaves a half-formed call with no result, and a
  // completed call whose arguments were `{}` rehydrates with its `input` field
  // absent. Either kind, once in durable history, fails every later turn on the
  // trip. Strip the interrupted ones and backfill the missing `{}` before the
  // conversation reaches the model.
  const { messages, dropped, repaired } = sanitizeConversation(rawMessages);
  if (dropped.length > 0) {
    console.warn(
      `[chat] Stripped ${dropped.length} interrupted tool call(s) from the reconstructed conversation before sending to the model:`,
      dropped,
    );
  }
  if (repaired.length > 0) {
    console.warn(
      `[chat] Backfilled empty input on ${repaired.length} reconstructed tool call(s) missing it before sending to the model:`,
      repaired,
    );
  }

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
      // Node's console truncates nested objects to `[Object]` at depth 2, which
      // hides the offending message inside an Anthropic 400
      // ("...tool_use.input: Field required"). Dump the exact request payload,
      // fully expanded, so any bad content block is readable.
      const body =
        error && typeof error === "object" && "requestBodyValues" in error
          ? (error as { requestBodyValues?: unknown }).requestBodyValues
          : undefined;
      if (body) console.dir(body, { depth: null });
      await run.end("error").catch(() => {});
    } finally {
      session.close();
      ably.close();
    }
  });

  return new Response(null, { status: 200 });
}
