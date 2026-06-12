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
| `@ably/ai-transport` | 0.1.0 (or latest) | Durable AI session transport; includes a Vercel AI SDK integration |
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

3. **Grant the right capabilities.** Session and state channels need `publish`, `subscribe`,
   and `history` (history is what makes session and canvas replay work on reload). LiveObjects
   channels additionally need the object capabilities.

4. **Keep the API key server-side only.** All key usage stays on the server (the token endpoint
   and the AI route). The browser only ever uses issued tokens.

5. **Suppress message echo where appropriate.** High-frequency publishers (and AI token
   streaming) should avoid receiving their own messages back. Configure echo suppression so the
   client isn't reprocessing its own publishes.

---

## Conceptual model

Everything is scoped to a single trip, identified by a `tripId` that appears in the URL. All
channels and state for that trip are namespaced by it. A clean convention is `trip:{tripId}:*`.

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

### Pub/Sub — ephemeral realtime events

Some things are signals, not state: a pin animating onto the map, or a collaborator joining.
The durable facts already live in LiveObjects (the destination exists in the itinerary);
Pub/Sub carries the transient event that drives the live animation or notification.

- A channel like `trip:{tripId}:pins` carries pin-placement events for the map to animate.
- **Presence** on a trip channel tracks who is currently viewing, for the collaborator avatars.

Rule of thumb: if losing the message on reload is fine because the data is reconstructable from
LiveObjects, it belongs on Pub/Sub. If it must survive reload, it belongs in LiveObjects.

### AI Transport — the durable conversation

The AI conversation for a trip is an AI Transport session on a channel like
`trip:{tripId}:session`. AI Transport provides:

- **Token streaming** to the chat panel.
- **Durability and resumption** — the session and its history survive tab closes and device
  switches, restored from channel history on reconnect.
- **Editing and branching** — revising an earlier turn creates a branch without destroying the
  original, which is how "swap a destination but keep the old plan" works.

The browser uses the AI Transport client (and its React hooks) for the chat panel. The server
uses the AI Transport server side together with the Vercel AI SDK.

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
- **Treating Pub/Sub as the source of truth.** If the map rebuilds only from pin events, pins
  vanish on reload. Pins must be derivable from LiveObjects state; Pub/Sub only animates them.
- **Putting the whole plan in the chat transcript.** If the plan lives in prose, the canvas is
  decorative. The structured items must be the canvas state.
- **Holding the API key in the browser.** Always use issued tokens with a `clientId`.
- **Not subscribing the UI to state changes.** The canvas panels must react to LiveObjects
  changes, not to one-off messages, so reload and late-joining collaborators get correct state.
