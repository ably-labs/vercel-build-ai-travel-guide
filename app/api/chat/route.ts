import { anthropic } from "@ai-sdk/anthropic";
import { Invocation, type InvocationData } from "@ably/ai-transport";
import { createAgentSession } from "@ably/ai-transport/vercel";
import { convertToModelMessages, streamText } from "ai";
import Ably from "ably";
import { after } from "next/server";

import { tripIdFromSessionChannel } from "@/lib/channels";

export const runtime = "nodejs";
// The response returns immediately, but after() keeps streaming the AI
// response over Ably — give it room to finish.
export const maxDuration = 300;

const SYSTEM_PROMPT = `You are Wayfarer, an expert AI travel planner. You help
users plan trips through conversation.

Be concrete and decisive: suggest specific destinations, day-by-day plans, and
bookings (flights, hotels, activities) with realistic indicative prices in the
user's currency (default USD). Ask at most one clarifying question when the
request is genuinely ambiguous; otherwise make sensible assumptions and state
them briefly. Keep responses conversational and reasonably short — the
detailed plan will live on the trip canvas, not in the chat.`;

// AI Transport agent endpoint. The client's ChatTransport POSTs an invocation
// here to wake the agent; the user's message is already on the Ably channel.
// We load the conversation from channel history, run the model, and stream
// the response back over the same channel (not the HTTP response body).
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

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
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
