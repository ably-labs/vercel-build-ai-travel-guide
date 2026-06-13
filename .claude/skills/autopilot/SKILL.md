---
name: autopilot
description: Autonomous backlog driver for the Wayfarer epic (AIT-936). One wave per invocation — run under /loop. Reconciles ticket status end-to-end (merged PRs → Done, closed → back to To Do), infers and persists the dependency graph, dispatches parallel workers in isolated worktrees for every currently-claimable ticket, and rebases stale open PRs to keep them mergeable. The only human steps are filing tickets (report-issue) and reviewing + merging PRs.
---

Drive the AIT-936 backlog with no human in the loop except **filing tickets** (`report-issue`) and **reviewing + merging PRs**. Everything else — status management, dependency ordering, finding work, preventing duplicate work, and conflict resolution — is automatic.

Run this **under `/loop`**: `/loop /autopilot`. Each invocation runs **one wave** (the four phases below) and returns; `/loop` re-invokes it, so freshly-merged PRs unblock dependents on the next wave. Phases run in order — earlier phases set up state the later ones rely on.

Load `jira` tools (`searchAblyTools` category `jira`) and ensure `gh` is authenticated before starting.

## Phase 1 — Reconcile status end-to-end

Bring Jira in line with what happened on GitHub — crucially, this is where a **human merging a PR moves the ticket to Done** and unblocks its dependents for this wave's Phases 2–3.

Invoke the **`sync-ticket-status`** skill. It handles every In Review ticket: PR merged → **Done** (+ branch cleanup); PR closed unmerged → back to **To Do** (unassigned); PR still open → left for Phase 4; no PR found → bounced back to To Do.

Then handle the one case `sync-ticket-status` doesn't — dead workers: for each **In Progress** ticket with no branch and no open PR that isn't being actively built by a worker this wave, transition it back to To Do and unassign so it can be re-picked. Be conservative; don't reclaim one a worker is mid-flight on.

## Phase 2 — Refresh the dependency graph

Infer relationships across the whole open backlog and persist them as Jira links, once per wave, centrally (so the parallel workers don't each redo it or race on link creation). This is the agent's job — derive the judgments yourself by reasoning over ticket content and persist them durably; **never ask a human.**

Follow the inference + idempotent `jiraCreateIssueLink` procedure described in `work-next-ticket` step 2 (extends an API/schema/migration, prose key references, ordered shared surfaces; conservative; `link_type: "Blocks"`, outward = blocker, inward = blocked; skip links that already exist). **Heed the link-direction gotcha documented there** — get the direction right the first time (`inward` = blocked, `outward` = blocker), ignore the tool's inverted ✅ confirmation, and verify only via `jiraGetIssue(... additional_fields: ["issuelinks"])` raw JSON, never JQL `linkedIssues(...)`; there is no tool to delete a reversed link.

## Phase 3 — Dispatch a parallel wave of workers

Compute the **claimable set** — every To Do ticket that passes all of `work-next-ticket` step 3's guards: unassigned, no remote/local branch (`git ls-remote --heads origin "<key>-*"`), no open PR, and **all blockers Done**. Independent tickets are parallel-safe; blocked ones are intentionally excluded and wait for a future wave.

- If the claimable set is **empty**, do **not** necessarily stop — check what's in flight (see End of wave). If tickets are still In Review awaiting a human merge, this wave does no dispatch but the loop must keep going so Phase 1 catches those merges. Only when nothing is in flight either is the backlog truly drained.
- Otherwise dispatch up to **4 workers concurrently** (cap — raise only if the machine can take it). For each chosen ticket, launch a **background `Agent` with `isolation: "worktree"`** so each gets its own isolated checkout and they cannot collide. Send all the wave's agents in a **single message** (multiple `Agent` calls) so they run in parallel. Each agent's prompt:

  > You are in a fresh, isolated git worktree. Work Wayfarer ticket `<key>` end to end by invoking the `work-next-ticket` skill with that exact key. It will claim the ticket atomically (skip if already lost), implement via `work-on-issue` — which implements directly against existing codebase patterns, since `/goal` is UI-only and not callable by a dispatched worker — then rebase onto `origin/main`, push, open a PR, and move the ticket to In Review. Do not call EnterWorktree — you are already isolated. Report the PR URL, or `lost claim on <key>`, or the blocker if you had to stop.

  Duplicate work is prevented at two levels: this wave hands each ticket to exactly one worker, and `work-on-issue`'s atomic claim stops any cross-wave or cross-operator collision.

Wait for the wave's workers to finish (they run in the background; you're notified on completion). Collect each result.

## Phase 4 — Keep open PRs mergeable (conflict resolution)

Any PR that was fine when opened goes stale the moment a sibling merges ahead of it. Invoke the **`rebase-stale-prs`** skill: it finds every open AIT PR that is now `BEHIND` / conflicting with `main`, rebases each onto `origin/main` via `/git-rebase`, and force-pushes with `--force-with-lease` — flagging for a human only the conflicts it can't safely resolve. This runs right after Phase 1 has merged-and-Done'd tickets, so the PRs left behind by those merges get refreshed in the same wave.

## End of wave

Print a concise summary: tickets moved to Done this wave, PRs opened (with URLs), PRs rebased, and what remains blocked and on whom.

Then decide whether to continue:
- **Keep looping** if anything is still in flight — any ticket In Review (awaiting a human merge) or In Progress, or any open PR. There's no claimable work right now, but the loop must keep running so the next wave's Phase 1 turns merges into Done and unblocks dependents. Pace these idle waves gently (a longer interval is fine — nothing happens until a human acts).
- **Stop the loop** only when the epic is genuinely drained: no To Do, no In Progress, no In Review, no open PRs. Report "backlog fully drained" and end.

This is the key behaviour: a merge by a human is reflected automatically because the loop is still alive — through `autopilot`, or independently via `/loop /sync-ticket-status`.
