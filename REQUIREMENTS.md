# Wayfarer — Requirements & Goals

This document defines *what* Wayfarer must do and *why*. It is intentionally written from a
product perspective. It states the stack and the feature requirements, but it does not
prescribe implementation details — schemas, function signatures, and component structure are
left to the build. Where a technical constraint is genuinely load-bearing (for example, an
Ably configuration step the product depends on), it is called out in
[`ABLY_INTEGRATION.md`](./ABLY_INTEGRATION.md).

---

## 1. Vision

Travel planning is a multi-day, multi-person, multi-device activity, but the software for it
is either a forgetful chatbot or a booking engine that treats AI as a search box. Wayfarer
makes the AI work on a shared, durable, visual canvas. You direct it through chat; it builds a
real itinerary you can see, edit, and share.

The single sentence that should guide every product decision:

> The canvas is the product. Chat is how you talk to it.

---

## 2. The problem

- **Sessions are ephemeral.** Today's AI travel tools lose everything on a tab close or
  refresh. A trip takes days to plan; the tool should persist across all of it.
- **Planning is collaborative, but the tools aren't.** Couples, families, and friends plan
  together. There is no shared, live workspace where everyone sees the same plan evolve.
- **Chat output is invisible.** A wall of generated text is not a plan. The output needs
  structure the user can scan, rearrange, and act on.
- **Device continuity doesn't exist.** People start on a laptop and continue on a phone. The
  trip should follow the user across devices without re-prompting.

---

## 3. Target users

- **Primary: the trip organiser.** The person who takes the lead planning a trip for
  themselves and others. Wants to go from a vague idea to a concrete, shareable itinerary
  without juggling tabs, docs, and spreadsheets.
- **Secondary: the co-traveller.** Joins via a shared link, watches the plan come together,
  and chips in their own requests ("can we add a rest day?") without stepping on the
  organiser.

---

## 4. Product goals

1. **The canvas is the primary surface.** The AI's output is structured visual content — map
   pins, day cards, budget figures — not conversational prose. A user who never reads the chat
   transcript should still understand the whole plan from the canvas alone.
2. **Sessions are durable by default.** Closing the browser, switching devices, or returning
   the next day must restore the full canvas and conversation. Persistence is the default
   behaviour, not a save button.
3. **Collaboration is real and live.** Anyone with the link sees the same canvas update in
   realtime and can direct the AI. Presence makes it obvious who else is here.
4. **The AI writes to the canvas, not a chat bubble.** Adding a destination places a pin;
   booking a hotel drops a card; changing plans updates the budget. The chat confirms actions;
   it does not contain the plan.

---

## 5. Feature requirements

Requirements are grouped by surface. Each is a user-facing capability, not an implementation
instruction. "Must" items are required for a complete product; "Should" items are valuable but
sacrificeable under time pressure.

### 5.1 The canvas — map panel

- **Must** show a map that displays a pin for every destination in the trip.
- **Must** add, move, and remove pins live as the AI changes the itinerary, with no manual
  refresh.
- **Should** draw route lines between destinations in trip order.
- **Should** let a user click a pin to focus the corresponding day(s) on the board.

### 5.2 The canvas — day board

- **Must** present the trip as a day-by-day (or destination-by-destination) board.
- **Must** show cards for the key item types: flights, accommodation, and activities.
- **Must** render new and changed cards live as the AI builds the plan, including showing
  content as it streams in rather than appearing only when complete.
- **Should** visually distinguish item types at a glance.

### 5.3 The canvas — budget tracker

- **Must** show a running total cost for the trip.
- **Must** update the total live as the AI adds, changes, or removes priced items.
- **Should** break the total down by category (e.g. flights, accommodation, activities).
- **Should** show progress against a user-stated budget cap and signal when it is exceeded.

### 5.4 The AI command panel (chat)

- **Must** accept free-text instructions that direct the AI to build or change the trip.
- **Must** stream the AI's response token-by-token.
- **Must** have the AI's actions reflected on the canvas in the same interaction — the user
  should see the canvas change as (or immediately after) the AI responds.
- **Must** preserve the full conversation history for the trip.
- **Should** let a user edit an earlier instruction and have the AI revise the plan, while
  keeping the previous version available to compare.
- **Should** let a user stop the AI mid-response.

### 5.5 Session durability

- **Must** restore the complete canvas and conversation when a user reopens the trip in a new
  tab, after a refresh, or on a different device.
- **Must** require no explicit save action — persistence is automatic.

### 5.6 Collaboration

- **Must** let multiple people open the same trip via a shared link and see the same canvas
  update live.
- **Must** allow any collaborator to direct the AI.
- **Should** show presence — who else is currently viewing the trip.

### 5.7 Onboarding & sharing

- **Must** let a user start a new trip and receive a shareable link to it.
- **Should** support a one-line starting prompt (destination, dates, interests, budget) that
  seeds the first plan.

---

## 6. Ably product mapping (product-level)

The product depends on three Ably products, each with a distinct role. Implementation detail
lives in `ABLY_INTEGRATION.md`; this is the product-level division of responsibility.

| Ably product | Owns | Rationale |
| --- | --- | --- |
| **LiveObjects** | The durable canvas state: itinerary (days, stops, bookings) and budget. | The AI and all collaborators write to one shared, conflict-free state. No bespoke sync, no race conditions. This is the source of truth for the canvas. |
| **Pub/Sub** | Ephemeral realtime events: map pin animations, collaborator presence. | These are transient signals, not data to be replayed on load — the underlying data already lives in LiveObjects. Pub/Sub fires the live updates. |
| **AI Transport** | The AI conversation as a durable, resumable session, including token streaming and the ability to revise earlier turns. | The session that drives the canvas must survive tab closes and device switches, and support editing/branching the plan. |

---

## 7. Success criteria

The build is successful when this end-to-end sequence works without manual intervention:

1. A user starts a trip, enters a one-line prompt, and watches the map, board, and budget
   populate live from a single AI response.
2. The user closes the tab, reopens the link, and finds the canvas and conversation intact.
3. A second person opens the same link on another device and sees the live canvas; either
   person can direct the AI and both see the result.
4. A user revises an earlier instruction and the plan updates, with the previous version still
   reachable.

If a judge or new user can watch that sequence and immediately understand the value, the
product has met its goal.

---

## 8. Non-goals (out of scope)

- **Real bookings or payments.** The AI produces a plan with indicative prices. No real
  inventory, no checkout.
- **A separate database.** State lives in Ably LiveObjects; conversation lives in AI
  Transport. Do not introduce Supabase or similar unless a milestone explicitly requires it.
- **Full authentication and accounts.** Trips are reached by shareable link. Anyone with the
  link is a collaborator. A proper auth/identity layer is a future concern, not part of this
  build.
- **Native mobile apps.** The web app must work well in a mobile browser, but no native apps.

---

## 9. Stretch goals

Pursue only after the success criteria in section 7 are met.

- **Voice input/output** for the command panel (e.g. via ElevenLabs).
- **Live collaborator cursors** on the map and board.
- **Branch comparison UI** that shows two versions of a plan side by side.
- **Export** the finished itinerary (shareable read-only view or document).

---

## 10. Stack

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

Pin versions and the non-obvious Ably configuration in `ABLY_INTEGRATION.md` before writing
integration code.
