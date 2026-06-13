---
name: autopilot
description: Autonomous backlog driver for the Wayfarer epic (AIT-936). A continuous fill-the-pool scheduler — run under /loop. Reconciles ticket status end-to-end (merged PRs → Done, closed → back to To Do), infers and persists the dependency graph, keeps a live pool of parallel workers in isolated worktrees topped up to the concurrency cap as soon as slots free, dispatches newly-claimable work the moment it appears (freshly-filed or just-unblocked) instead of waiting for a whole wave to drain, and rebases stale open PRs to keep them mergeable. The only human steps are filing tickets (report-issue) and reviewing + merging PRs.
---

Drive the AIT-936 backlog with no human in the loop except **filing tickets** (`report-issue`) and **reviewing + merging PRs**. Everything else — status management, dependency ordering, finding work, preventing duplicate work, and conflict resolution — is automatic.

This is a **continuous fill-the-pool scheduler**, not a wave with a hard barrier. It maintains a live pool of up to **N = 4** background workers and, instead of waiting for a whole batch to finish before computing the next one, it **tops the pool back up the moment a slot frees** — so a fast worker that finishes early immediately picks up the next claimable ticket, and freshly-filed or newly-unblocked tickets start almost as soon as they appear. (This supersedes the older wave-based design, where Phase 3 dispatched a batch and then blocked on the slowest worker before the next wave's reconcile/dispatch could run.)

Run this **under `/loop`**: `/loop /autopilot`. One invocation runs the scheduler loop below until the backlog is genuinely drained or only human action (a merge) remains, then returns; `/loop` re-invokes it so it stays alive across human merges. The loop self-paces — it reacts to worker completions, and polls on a gentle interval when only merges are pending.

Load `jira` tools (`searchAblyTools` category `jira`) and ensure `gh` is authenticated before starting.

## Stage A — Reconcile status end-to-end

Bring Jira in line with what happened on GitHub — crucially, this is where a **human merging a PR moves the ticket to Done** and unblocks its dependents.

Invoke the **`sync-ticket-status`** skill. It handles every In Review ticket: PR merged → **Done** (+ branch cleanup); PR closed unmerged → back to **To Do** (unassigned); PR still open → left for Stage D; no PR found → bounced back to To Do.

Then handle the one case `sync-ticket-status` doesn't — dead workers: for each **In Progress** ticket with no branch and no open PR that **isn't a live worker in the current pool**, transition it back to To Do and unassign so it can be re-picked. Be conservative; never reclaim a ticket a pool worker is mid-flight on (track the keys you've dispatched — see Stage C).

This stage runs once at startup and again on every reconcile tick (Stage E), so merges and closures are reflected continuously, not just at a wave boundary.

## Stage B — Refresh the dependency graph

Infer relationships across the whole open backlog and persist them as Jira links — **centrally, in the scheduler, never inside a worker** — so the parallel workers don't each redo it or race on link creation. This is the agent's job — derive the judgments yourself by reasoning over ticket content and persist them durably; **never ask a human.**

Follow the inference + idempotent `jiraCreateIssueLink` procedure described in `work-next-ticket` step 2 (extends an API/schema/migration, prose key references, ordered shared surfaces; conservative; `link_type: "Blocks"`, outward = blocker, inward = blocked; skip links that already exist). **Heed the link-direction gotcha documented there** — get the direction right the first time (`inward` = blocked, `outward` = blocker), ignore the tool's inverted ✅ confirmation, and verify only via `jiraGetIssue(... additional_fields: ["issuelinks"])` raw JSON, never JQL `linkedIssues(...)`; there is no tool to delete a reversed link.

Run this once at startup, and **re-run it incrementally on a reconcile tick only for tickets new since the last inference pass** (freshly filed via `report-issue`, or ones whose links you haven't evaluated yet) — keeping it central means new tickets get their blockers linked before they're ever considered claimable, and no worker races on link creation.

## Stage C — Compute the claimable set and fill the pool

Compute the **claimable set** — every To Do ticket that passes all of `work-next-ticket` step 3's guards: unassigned, no remote/local branch (`git ls-remote --heads origin "<key>-*"`), no open PR, and **all blockers Done**. Independent tickets are parallel-safe; blocked ones are intentionally excluded and become claimable on a later tick once their blockers merge.

Maintain a **live pool** with a hard cap of **N = 4** concurrent workers (raise only if the machine can take it). Track the set of keys currently dispatched-and-running so reconcile (Stage A) won't reclaim them and so you never double-dispatch one.

Fill the pool: while `running_workers < N` **and** the claimable set is non-empty, pop the highest-priority claimable ticket, mark it dispatched, and launch **one** worker for it. **Do not wait for the wave to drain before topping up** — that's the whole point.

Each worker is a **background `Agent` with `isolation: "worktree"`** (`run_in_background: true`) so it gets its own isolated checkout and they cannot collide. When filling more than one slot in the same tick, send those `Agent` calls in a **single message** so they start in parallel. Each agent's prompt:

> You are in a fresh, isolated git worktree. Work Wayfarer ticket `<key>` end to end by invoking the `work-next-ticket` skill with that exact key. It will claim the ticket atomically (skip if already lost), implement via `work-on-issue` — which implements directly against existing codebase patterns, since `/goal` is UI-only and not callable by a dispatched worker — then rebase onto `origin/main`, push, open a PR, and move the ticket to In Review. Do not call EnterWorktree — you are already isolated. Report the PR URL, or `lost claim on <key>`, or the blocker if you had to stop.

Duplicate work is prevented at three levels: the scheduler hands each ticket to exactly one worker and tracks it as dispatched; the `git ls-remote`/PR guards exclude anything already in flight; and `work-on-issue`'s atomic claim stops any cross-operator collision (a worker that reports `lost claim on <key>` just frees its slot — drop the key and let the next fill pick something else).

## Stage D — Keep open PRs mergeable (conflict resolution)

Any PR that was fine when opened goes stale the moment a sibling merges ahead of it. Invoke the **`rebase-stale-prs`** skill: it finds every open AIT PR that is now `BEHIND` / conflicting with `main`, rebases each onto `origin/main` via `/git-rebase`, and force-pushes with `--force-with-lease` — flagging for a human only the conflicts it can't safely resolve.

Run this on each reconcile tick (Stage E), right after Stage A has merged-and-Done'd tickets, so the PRs left behind by those merges get refreshed promptly rather than waiting for a wave boundary.

## Stage E — Steady-state scheduler loop

After the startup pass (Stages A → B → C → D), settle into a steady state. **Wake on either trigger:**

1. **A pool worker completes** — you're notified on background-agent completion. Collect its result (PR URL, `lost claim`, or blocker), drop it from the running set (freeing a slot), then run the reconcile-and-refill step below.
2. **A poll interval elapses** with nothing else happening — when the pool is idle or only merges are pending, wake on a gentle interval (longer is fine; nothing moves until a human merges) and run the reconcile-and-refill step so human merges turn into Done and unblock dependents.

**Reconcile and refill** on each wake:
- **Stage A** — reconcile status (catches human merges → Done, closures → To Do, dead workers → To Do), skipping any key currently in the running pool.
- **Stage B (incremental)** — infer + link blockers for any tickets new since the last pass.
- **Stage D** — rebase any newly-stale open PRs.
- **Stage C** — recompute the claimable set and **top the pool back up to N** with any newly-claimable tickets (just-unblocked or freshly-filed).

Then check termination (below). This keeps every slot busy whenever there's claimable work, and starts new work the instant it becomes claimable.

## Termination

After each reconcile-and-refill, decide whether to continue:
- **Keep looping** if anything is still in flight — any pool worker still running, any ticket In Review (awaiting a human merge) or In Progress, or any open PR. When there's no claimable work but merges are pending, keep the loop alive on the gentle poll interval so the next reconcile turns merges into Done and unblocks dependents.
- **Stop** only when the epic is genuinely drained: pool empty, and no To Do, no In Progress, no In Review, no open PRs. Report "backlog fully drained" and end.

Print a concise running summary as things change: tickets moved to Done, PRs opened (with URLs), PRs rebased, workers dispatched, and what remains blocked and on whom.

This is the key behaviour: a merge by a human is reflected automatically because the loop is still alive — through `autopilot`, or independently via `/loop /sync-ticket-status` — and a freed slot or newly-unblocked ticket is filled immediately, without waiting for a whole wave to drain.
