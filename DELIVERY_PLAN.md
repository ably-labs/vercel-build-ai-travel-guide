# Wayfarer — Delivery Plan

An incremental milestone plan. Each milestone is a thin, shippable slice that leaves the app
in a working, demonstrable state. Build them in order. Do not start a milestone until the
previous one meets its "Done when" gate.

The plan is deliberately framed around capability, not code. *How* you build each slice is
your call; *what* the slice must demonstrate is fixed.

This is scoped for a roughly four-hour hackathon build, but the milestone boundaries hold
regardless of timeline. If time runs short, ship through the highest milestone that fully
passes its gate rather than leaving several half-done.

---

## Guiding principle: always have a working app

Prefer a vertical slice over horizontal layers. At every milestone the app should run, deploy,
and demonstrate something real. A walking skeleton that does one thing end-to-end beats four
disconnected pieces that don't talk to each other.

Deploy to Vercel from Milestone 0 and keep it deployable throughout. Don't leave deployment to
the end.

---

## Milestone 0 — Foundation (deployable skeleton)

**Goal:** A running, deployed Next.js app on Vercel with Ably connectivity proven.

**Scope:**
- Next.js app created and deploying to Vercel on push.
- Ably account and app configured (see `ABLY_INTEGRATION.md` for the required namespace
  settings — do this now, not later).
- Browser can authenticate to Ably and open a connection.
- A trip is addressable by an ID in the URL; visiting a fresh ID creates a new empty trip.
- Static canvas layout in place: four regions (map, day board, budget, chat) with no live
  content yet.

**Done when:** The deployed app loads at a trip URL, shows the empty four-panel layout, and a
browser successfully connects to Ably (verifiable in logs or a debug indicator).

---

## Milestone 1 — AI chat as a durable session

**Goal:** A working AI conversation over Ably AI Transport.

**Scope:**
- The chat panel sends instructions to the AI and streams responses back token-by-token.
- The conversation runs as an AI Transport session keyed to the trip.
- Conversation history is restored on reload — reopening the trip shows the prior exchange.

**Done when:** A user can hold a multi-turn conversation with the AI in the chat panel, close
and reopen the tab, and see the full conversation history restored. No canvas updates yet — the
AI just talks.

---

## Milestone 2 — AI writes structured itinerary to shared state

**Goal:** The AI's output becomes structured canvas state in LiveObjects, and the day board
renders it.

**Scope:**
- The AI emits structured trip items (destinations, days, and bookings such as flights, hotels,
  activities) as part of its response.
- Those items are written into the trip's LiveObjects state during the same interaction.
- The day board renders directly from LiveObjects state and updates live as items are written,
  including showing content as it streams in.

**Done when:** A user types a planning instruction and watches day cards populate the board live
as the AI responds. Reloading the trip restores the board from LiveObjects. This is the core
"AI writes to the canvas" capability — protect the time for it.

---

## Milestone 3 — Map and budget come alive

**Goal:** The remaining canvas panels react to the same AI-driven state.

**Scope:**
- Map panel renders a pin per destination, driven by the trip state.
- New pins appear live via a Pub/Sub event as the AI adds destinations (animation/realtime
  signal over Pub/Sub; the durable pin data lives in LiveObjects).
- Budget tracker shows a running total that updates live as priced items change.

**Done when:** A single planning instruction visibly updates all three canvas panels — board,
map, and budget — together. Reloading restores all of them.

---

## Milestone 4 — Live collaboration

**Goal:** Two people, one trip, live.

**Scope:**
- Opening the same trip link in a second browser shows the same canvas, updating live.
- Either participant can direct the AI; both see the result on the canvas.
- Presence shows who is currently viewing the trip.

**Done when:** With two browser windows open on the same trip URL, an instruction typed in one
updates the canvas in both, and each window shows that the other participant is present.

---

## Milestone 5 — Revise and branch

**Goal:** Plans can change without losing history.

**Scope:**
- A user can edit an earlier instruction and have the AI revise the plan.
- The previous version of the plan remains reachable for comparison.
- A user can stop the AI mid-response.

**Done when:** A user changes an earlier instruction (e.g. swaps a destination), the canvas
updates to the revised plan, and the user can navigate back to the prior version.

---

## Milestone 6 — Demo polish

**Goal:** The product reads instantly to a first-time viewer.

**Scope:**
- Streaming card animation, pin-drop animation, budget bar fill — make the live updates
  legible and satisfying.
- A clean first-run state and a seed prompt so a cold demo starts fast.
- Tidy empty/loading states so nothing looks broken mid-stream.
- Verify the full success-criteria sequence (see `REQUIREMENTS.md` section 7) end to end on
  the deployed Vercel URL.

**Done when:** A new viewer can watch the success-criteria sequence on the live URL and
understand the product without explanation.

---

## Cut order under time pressure

If you must drop scope, cut from the bottom up:

1. Keep Milestones 0–3 at all costs — they are the product.
2. Milestone 4 (collaboration) is the strongest differentiator after the core; keep it if at
   all possible.
3. Milestone 5 (branch/revise) can become a single "edit and re-plan" without the comparison
   UI.
4. Milestone 6 polish is the first thing to trim, but reserve at least a short block for it —
   an unpolished live update undersells the whole idea.

---

## Definition of done (whole project)

The deployed app passes the four-step success-criteria sequence in `REQUIREMENTS.md` section 7:
populate the canvas live from one prompt, survive a reload, support a live second collaborator,
and revise an earlier instruction with history preserved.
