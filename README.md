# Wayfarer

An AI travel planning canvas. Chat directs the AI; the canvas is where it works.

Unlike a chatbot that returns a wall of text, Wayfarer gives the AI a shared visual workspace. Ask it to plan a trip and it places pins on a map, drops cards into a day-by-day board, and updates a running budget, live, in front of you. The chat panel is one input method, not the product.

Wayfarer is a demo of [Ably AI Transport](https://ably.com/docs/ai-transport). It is a standard [Vercel AI SDK](https://ai-sdk.dev) `useChat` app, except the chat session runs on Ably instead of a single HTTP connection. That one change makes the AI stream resumable, shared across tabs and devices, and live for everyone planning the trip, with no database.

**[Try it live](https://vercel-build-ai-travel-guide.vercel.app/)** - plan a trip, then open the same link in a second tab or on your phone and watch it stay in sync.

## What it demonstrates

- **Resumable streaming.** Refresh mid-plan and the response picks up where it stopped. The model never re-runs.
- **Multi-user conversations.** Everyone with the trip link shares one conversation. Anyone can send a prompt to the same agent, and the reply and the plan it builds update for the whole group rather than for one person. It is a chat with more than one human in it, not a private session each.
- **Multi-tab and multi-device continuity.** Open the trip on a laptop and a phone and both follow the same live response, then settle on the same history.
- **A shared, subscribable canvas.** The map, day board, and budget are the source of truth, not the chat transcript. The AI writes them through tools, and every viewer's canvas updates per edit, live.
- **Presence.** Avatars show who is planning the trip with you, one per person regardless of how many tabs they have open.
- **Cancellation.** The Stop button is a real signal the agent receives, not just a closed socket.

All of it runs on one durable session: a single Ably channel per trip, `trip:<id>:session`.

## How Ably is used

Everything for a trip runs on **one** Ably channel, `trip:<id>:session`. That single channel is the whole durable session: the AI Transport chat stream, the LiveObjects canvas state, and presence all ride it together. It is the source of truth that every client and the agent derive from.

| Layer | Ably product | What it delivers in Wayfarer |
|---|---|---|
| Transport | AI Transport over Pub/Sub | Resumable streaming, multi-user conversations, multi-tab and multi-device continuity, cancellation, history with no database |
| Shared state | LiveObjects (`LiveMap` + `LiveCounter`) | The map, day board, and budget as live, subscribable state that every viewer sees update per edit |
| Presence | Presence | Avatars of who is in the trip, one per person |

One channel carries all three because LiveObjects, presence, and the AI Transport conversation can share it. The AI Transport SDK attaches the channel with the LiveObjects object modes (`channelModes: OBJECT_MODES`) unioned with the modes it always needs — and presence and pub/sub are already in that default set — so a single attach grants everything. The map's pin-drop animation is driven by changes to the LiveObjects destination set rather than a separate ephemeral channel: the durable destination data and the animation cue are the same write.

### The transport swap (client)

The client is a normal `useChat`, but the transport is Ably AI Transport. Two extra hooks connect the durable session to the hook's local state.

```tsx
// components/chat-panel.tsx
const { chatTransport } = useChatTransport();

const { messages, setMessages, sendMessage, stop, status } = useChat({
  id: tripId,
  transport: chatTransport, // Ably AI Transport, in place of the default HTTP transport
});

useMessageSync({ setMessages }); // sync session history, other participants, and resumed streams into useChat
useView({ limit: 30 });          // load recent history on mount
```

Because the session is shared, every participant's `sendMessage` publishes onto the same `trip:<id>:session` channel, and `useMessageSync` folds everyone's messages (and any resumed stream) into each client's view. That is what makes the conversation multi-user rather than one private chat per person.

### Streaming over the session (server)

The agent route does not stream down the HTTP response body. It opens the session, runs the model, and pipes the Vercel UIMessage stream back onto the session. The request returns immediately; the run keeps streaming in the background. History is rebuilt from the session, so there is no database.

```ts
// app/api/chat/route.ts
// channelModes: OBJECT_MODES attaches the same session channel for LiveObjects too.
const session = createAgentSession({
  client: ably,
  channelName: invocation.sessionName,
  channelModes: OBJECT_MODES,
});
await session.connect();

const run = session.createRun(invocation, { signal: req.signal });
await run.start();
const messages = await run.loadConversation(); // rebuilt from the session, no database

const result = streamText({ model: anthropic("claude-sonnet-4-6"), system, messages, tools });

after(async () => {
  const { reason } = await run.pipe(result.toUIMessageStream());
  await run.end({ reason });
});
return new Response(null, { status: 200 });
```

The agent's tools (`add_destination`, `add_day`, `add_stop`, `update_stop`, `move_stop`, `suggest_landmark`, and so on) write the plan into the same channel's LiveObjects through a server-side `TripStateWriter`. Edits are conflict-free batch operations, and the budget `LiveCounter` reconciles to the sum of priced stops after every change, so retries and re-planning can never inflate it.

### Shared canvas and presence (client)

The chat, the canvas, and presence share one `ClientSession` — opened once by a single `ChatTransportProvider` over `trip:<id>:session`. The chat reads it via `useChatTransport`; the canvas and presence read the same session by channel name via `useClientSession`, off its `object` and `presence` accessors. Every browser subscribes to the session's LiveObjects state and re-renders on each change, and renders the presence set as avatars.

```ts
// components/use-trip-state.ts - the canvas is a live projection of the session's LiveObjects state
const { session } = useClientSession({ channelName: sessionChannelName(tripId) });
const root = await session.object.get();
setState(root.compactJson() ?? {});
root.subscribe(() => setState(root.compactJson() ?? {}));
```

The browser authenticates to Ably through a token endpoint (`app/api/ably/token`), which issues short-lived token requests carrying the visitor's `clientId` and scoped to the `trip:*` namespace (with the object capabilities LiveObjects needs on that channel). The Ably API key never reaches the client.

## Running it locally

### Prerequisites

- Node 20+ and [pnpm](https://pnpm.io)
- An [Ably account](https://ably.com/sign-up) and an API key (the free tier is plenty)
- An [Anthropic API key](https://console.anthropic.com)

### 1. Configure the Ably channel namespace

AI Transport needs mutable messages and persistence on the channels it uses. In the Ably dashboard, add a channel rule for the `trip` namespace (namespace `trip`, matching `trip:*`) with:

- **Message annotations, updates, deletes, and appends** enabled (this is what lets a streamed reply be appended to a single message).
- **Persisted messages** enabled (so a client that reloads or joins late can rebuild the conversation from history).

### 2. Set environment variables

Create a `.env.local` in the project root:

```bash
ABLY_API_KEY=your-ably-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
```

Both are server-only. The browser never sees the Ably key; it uses the token endpoint instead.

### 3. Install and run

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000, pick a seed prompt (or type your own), and watch the canvas fill in. Open the trip URL in a second tab or on your phone to see the session stay in sync.

## Tech stack

- **Next.js 16** (App Router) and **React 19**
- **Vercel AI SDK** (`ai`, `@ai-sdk/react`) with **`@ai-sdk/anthropic`** running **Claude Sonnet 4.6** (swappable)
- **Ably**: [`@ably/ai-transport`](https://github.com/ably/ably-ai-transport-js), [`ably`](https://github.com/ably/ably-js) (with the LiveObjects plugin)
- **MapLibre GL**, **Tailwind CSS 4**, **Zod**, **TypeScript**

## Learn more

- [Try the live demo](https://vercel-build-ai-travel-guide.vercel.app/)
- [Ably AI Transport docs](https://ably.com/docs/ai-transport)
- [Introducing AI Transport v0.2.0](https://ably.com/blog/introducing-ai-transport-v0-2-0) - durable sessions, runs, and branching
- [The `@ably/ai-transport` SDK](https://github.com/ably/ably-ai-transport-js)
