# Wayfarer

An AI travel planning canvas. Chat directs the AI; the canvas is where it works.

Unlike a chatbot that returns a wall of text, Wayfarer gives the AI a shared visual
workspace. When you ask it to plan a trip, it places pins on a map, drops cards into a
day-by-day board, and updates a running budget — live, in front of you. The chat panel
is one input method, not the product.

The product is built on three Ably realtime products working together:

- **Ably AI Transport** powers the AI chat as a durable session — close the tab, switch
  devices, come back tomorrow, and the conversation resumes exactly where it left off.
- **Ably LiveObjects** holds the itinerary and budget as shared, conflict-free state that
  the AI and every collaborator write to simultaneously.
- **Ably Pub/Sub** delivers the live, ephemeral events — map pins appearing, collaborator
  presence — to every connected browser in realtime.

## Documents

Read these in order before starting:

1. [`REQUIREMENTS.md`](./REQUIREMENTS.md) — the product vision, goals, personas, and
   feature requirements. This is the *what* and *why*.
2. [`DELIVERY_PLAN.md`](./DELIVERY_PLAN.md) — the incremental milestone plan. This is the
   order to build in, with a clear "done when" gate per milestone.
3. [`ABLY_INTEGRATION.md`](./ABLY_INTEGRATION.md) — the role each Ably product plays, the
   conceptual data/channel model, and the non-obvious setup steps you must not skip.

## Stack at a glance

| Layer | Choice |
| --- | --- |
| Framework | Next.js (App Router) |
| Hosting | Vercel |
| AI orchestration | Vercel AI SDK |
| Model | Anthropic Claude (current Sonnet) via the Anthropic provider |
| AI session transport | Ably AI Transport (`@ably/ai-transport`) |
| Shared state | Ably LiveObjects (via the `ably` JS SDK plugin) |
| Realtime events | Ably Pub/Sub (`ably`) |
| Map | Mapbox GL JS or MapLibre GL |
| Styling | Tailwind CSS |

## A deliberate stack note

State lives in Ably LiveObjects, not a separate database. For the scope of this project we
do **not** need Supabase or another persistence layer — the itinerary and budget are held in
LiveObjects, and the conversation history is held by AI Transport. Don't add a database
unless a milestone explicitly calls for one.

Trips are reached via a shareable link containing a trip ID. Authentication is out of scope
for the core build (see non-goals in `REQUIREMENTS.md`); treat any visitor with the link as a
collaborator on that trip.
