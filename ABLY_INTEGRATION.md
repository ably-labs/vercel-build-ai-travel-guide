# Wayfarer — Ably Integration Context

This file gives the coding agent the Ably-specific context it needs to integrate correctly. It
describes the **role** of each Ably product, the **conceptual** data and channel model, and the
**non-obvious setup steps** that are easy to miss and will silently break the product if skipped.

It deliberately stops short of prescribing code. Treat the data model below as a conceptual
contract, not a schema to copy verbatim — choose the concrete shapes that fit your
implementation.

---

## Packages and versions

| Package | Version | Purpose |
| --- | --- | --- |
| `ably` | 2.21.0 (or latest 2.x) | Core JS SDK: connection, Pub/Sub, and the LiveObjects plugin |
| `@ably/ai-transport` | 0.3.0 (or latest) | Durable AI session transport; includes a Vercel AI SDK integration. Exposes the `channelModes` session option (pass `OBJECT_MODES`) plus the session's `object` and `presence` accessors, so LiveObjects and presence can share the AI Transport channel |
| Vercel AI SDK | latest | LLM orchestration on the server route |
| Anthropic provider | latest | Claude model access via the Vercel AI SDK |

Check the published versions at install time and pin them. The AI Transport SDK ships a
Vercel-specific entry point and React hooks — prefer the SDK's documented integration over
hand-rolling raw channel logic.

Authoritative references:
- AI Transport: https://ably.com/docs/ai-transport
- LiveObjects: https://ably.com/docs/liveobjects
- Pub/Sub basics: https://ably.com/docs/basics

---

## Critical setup — do this before writing integration code

These are the steps that don't fail loudly. Get them right up front.

1. **Enable mutable messages on the channel namespace used by AI Transport.** AI Transport
   relies on message updates/appends. The channel namespace must have **"Message annotations,
   updates, deletes, and appends"** enabled (the `mutableMessages` channel rule). Without it,
   AI Transport will not function. Configure this in the Ably dashboard (or via the Control
   API) for the namespace your session channels use.

2. **Use token authentication from the browser, with an identified client.** The browser must
   not hold the Ably API key. Issue short-lived tokens from a server endpoint. The token must
   carry a `clientId` so presence and message authorship work and cannot be spoofed client-side.

3. **Grant the right capabilities.** The single session channel needs `publish`, `subscribe`,
   `presence`, and `history` (history is what makes session and canvas replay work on reload),
   plus the `object-publish` / `object-subscribe` capabilities LiveObjects needs. Scoping a
   token to the whole `trip:*` namespace with all of these covers the one channel per trip.

4. **Keep the API key server-side only.** All key usage stays on the server (the token endpoint
   and the AI route). The browser only ever uses issued tokens.

5. **Suppress message echo where appropriate.** High-frequency publishers (and AI token
   streaming) should avoid receiving their own messages back. Configure echo suppression so the
   client isn't reprocessing its own publishes.

---

## Conceptual model

Everything is scoped to a single trip, identified by a `tripId` that appears in the URL, and
runs on **one** channel for that trip: `trip:{tripId}:session`. That single durable session
carries the AI Transport conversation, the LiveObjects canvas state, and presence together.
This is deliberate — the whole point is one durable session per trip, not a channel per
capability. It works because the AI Transport SDK attaches the channel with the LiveObjects
object modes (`channelModes: OBJECT_MODES`) unioned with the modes it always needs, and
presence and pub/sub are already in that default set, so one attach grants all three.

### LiveObjects — the durable canvas state (source of truth)

The trip's canvas state lives in a LiveObjects structure keyed to the trip. Conceptually:

- A top-level map for the trip holds the **itinerary** and the **budget**.
- The itinerary is organised by **day** (or by destination). Each day holds a set of **stops**.
- Each stop holds **bookings** — flights, accommodation, activities — each with the fields the
  UI needs to render a card (name, time, location, indicative price, etc.).
- The budget is a **counter** (or a small map of category counters) that the UI reads for the
  running total.

Both the AI (server-side) and every collaborator (browser-side) write into this same
structure. LiveObjects is conflict-free and centrally arbitrated, so concurrent writes
converge — you do not need to build sync or locking for the common case.

The canvas panels (map, board, budget) should render **from LiveObjects state** and subscribe
to its changes. When the AI writes a new stop, the board re-renders because the state changed —
not because of a separate message.

### Presence — who is on the trip

**Presence** tracks who is currently viewing the trip, for the collaborator avatars. It runs on
the same session channel via the session's `presence` accessor (presence is in the channel's
default mode set, so sharing the channel needs nothing extra). Each browser enters the presence
set while mounted and reads the live membership.

### Ephemeral signals vs durable state

Some things are signals, not state: a pin animating onto the map, or a collaborator joining.
The durable facts already live in LiveObjects (the destination exists in the itinerary), so the
animation cue does not need its own message — when a destination is written to LiveObjects, the
map drops its pin (with the drop animation) the moment that change arrives. There is no separate
`:pins` channel: the durable write and the animation trigger are one and the same.

Rule of thumb: if losing a message on reload is fine because the data is reconstructable, drive
the behaviour off the durable LiveObjects change rather than a separate ephemeral publish. If it
must survive reload, it belongs in LiveObjects. Reserve a dedicated ephemeral pub/sub message
only for a genuine signal that has no durable counterpart.

### AI Transport — the durable conversation

The AI conversation for a trip is an AI Transport session on the trip's `trip:{tripId}:session`
channel — the same channel that carries the LiveObjects state and presence. AI Transport
provides:

- **Token streaming** to the chat panel.
- **Durability and resumption** — the session and its history survive tab closes and device
  switches, restored from channel history on reconnect. History reconstruction
  (`loadConversation()`) works even though the channel also carries LiveObjects object messages
  and presence.
- **Editing and branching** — revising an earlier turn creates a branch without destroying the
  original, which is how "swap a destination but keep the old plan" works.

The browser uses the AI Transport client (and its React hooks) for the chat panel, and reads the
same session's `object` / `presence` accessors for the canvas and avatars. The server uses the
AI Transport server side together with the Vercel AI SDK.

---

## The key integration: AI response → canvas state in one interaction

The single most important behaviour is that **one AI interaction updates both the chat and the
canvas**. The server route should, within the same request:

1. Stream the AI's natural-language response back through AI Transport to the chat panel, and
2. Take the AI's **structured outputs** (the trip items it decided on — expressed as tool/function
   calls or structured output via the Vercel AI SDK) and write them into the trip's LiveObjects
   state.

In the Next.js App Router, the streaming response and the state writes can be coordinated so the
HTTP response isn't blocked by the state writes (the App Router provides an `after`-style hook
for post-response work). The product requirement is simply that the user sees the canvas change
as part of the same interaction — the exact mechanism is yours to choose.

Design the AI so its plan is expressed as discrete, structured items (add destination, add
stop, add booking, set/adjust budget) rather than only as prose. Prose goes to the chat; the
structured items become canvas state. This separation is what makes the canvas the product.

---

## Environment variables (names indicative)

Keep secrets server-side. At minimum you will need:

- An Ably API key (server only) for the token endpoint and the AI route.
- An Anthropic API key (server only) for the model.
- A Mapbox (or MapLibre tile) access token for the map.

Expose only what the browser genuinely needs (e.g. a public map token), and never the Ably or
Anthropic keys.

---

## Common pitfalls

- **Forgetting the mutable-messages namespace rule.** AI Transport silently misbehaves without
  it. This is the number-one setup mistake.
- **Treating an ephemeral signal as the source of truth.** If the map rebuilds only from
  transient pin events, pins vanish on reload. Pins must be derivable from LiveObjects state;
  here the drop animation is driven by the LiveObjects destination change itself, so it is
  durable by construction.
- **Putting the whole plan in the chat transcript.** If the plan lives in prose, the canvas is
  decorative. The structured items must be the canvas state.
- **Holding the API key in the browser.** Always use issued tokens with a `clientId`.
- **Not subscribing the UI to state changes.** The canvas panels must react to LiveObjects
  changes, not to one-off messages, so reload and late-joining collaborators get correct state.
