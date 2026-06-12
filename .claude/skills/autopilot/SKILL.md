---
name: autopilot
description: Autonomous backlog driver for the Wayfarer epic (AIT-936). One wave per invocation — run under /loop. Reconciles ticket status end-to-end (merged PRs → Done, closed → back to To Do), infers and persists the dependency graph, dispatches parallel workers in isolated worktrees for every currently-claimable ticket, and rebases stale open PRs to keep them mergeable. The only human steps are filing tickets (report-issue) and reviewing + merging PRs.
---

Drive the AIT-936 backlog with no human in the loop except **filing tickets** (`report-issue`) and **reviewing + merging PRs**. Everything else — status management, dependency ordering, finding work, preventing duplicate work, and conflict resolution — is automatic.

Run this **under `/loop`**: `/loop /autopilot`. Each invocation runs **one wave** (the four phases below) and returns; `/loop` re-invokes it, so freshly-merged PRs unblock dependents on the next wave. Phases run in order — earlier phases set up state the later ones rely on.

Load `jira` tools (`searchAblyTools` category `jira`) and ensure `gh` is authenticated before starting.

## Phase 1 — Reconcile status end-to-end

Pull the epic's tickets in flight and bring Jira in line with what actually happened on GitHub. Search `jiraSearchIssues`: `project = AIT AND parent = AIT-936 AND status in ("In Review","In Progress")`, fields `["summary","status","assignee"]`.

For each **In Review** ticket, find its PR (the PR title/body carries the key; `gh pr list --search "<key>" --state all --json number,state,mergedAt,headRefName`):
- **PR merged** → transition the ticket to **Done**: `jiraTransitionIssue { "issue_key": "<key>", "transition": "Done", "resolution": "Fixed", "comment": "Merged: <url>" }`. Then clean up: `git worktree prune` and delete the merged local branch if present. Moving it to Done is what unblocks its dependents in Phase 2/3.
- **PR closed without merging** → the change was rejected; transition back to **To Do**, clear the assignee (`jiraCreateUpdateIssue { "issue_key":"<key>", "assignee":"unassigned" }`), and comment why so it re-enters the pool.
- **PR still open** → leave it; Phase 4 keeps it mergeable.

For each **In Progress** ticket with **no branch and no open PR** and no active worker (a worker that died mid-run): if it's been stuck with no progress, transition back to To Do and unassign so it can be re-picked. Be conservative — don't reclaim one a worker is actively building this wave.

## Phase 2 — Refresh the dependency graph

Infer relationships across the whole open backlog and persist them as Jira links, once per wave, centrally (so the parallel workers don't each redo it or race on link creation). This is the agent's job — never ask a human.

Follow the inference + idempotent `jiraCreateIssueLink` procedure described in `work-next-ticket` step 2 (extends an API/schema/migration, prose key references, ordered shared surfaces; conservative; `link_type: "Blocks"`, outward = blocker, inward = blocked; skip links that already exist).

## Phase 3 — Dispatch a parallel wave of workers

Compute the **claimable set** — every To Do ticket that passes all of `work-next-ticket` step 3's guards: unassigned, no remote/local branch (`git ls-remote --heads origin "<key>-*"`), no open PR, and **all blockers Done**. Independent tickets are parallel-safe; blocked ones are intentionally excluded and wait for a future wave.

- If the claimable set is **empty**: report why (backlog drained, or everything left is waiting on a human to merge a blocker's PR) and **stop the loop** — there is no productive work until a merge happens.
- Otherwise dispatch up to **4 workers concurrently** (cap — raise only if the machine can take it). For each chosen ticket, launch a **background `Agent` with `isolation: "worktree"`** so each gets its own isolated checkout and they cannot collide. Send all the wave's agents in a **single message** (multiple `Agent` calls) so they run in parallel. Each agent's prompt:

  > You are in a fresh, isolated git worktree. Work Wayfarer ticket `<key>` end to end by invoking the `work-next-ticket` skill with that exact key. It will claim the ticket atomically (skip if already lost), implement via `work-on-issue` + `/goal`, rebase onto `origin/main`, push, open a PR, and move the ticket to In Review. Do not call EnterWorktree — you are already isolated. Report the PR URL, or `lost claim on <key>`, or the blocker if you had to stop.

  Duplicate work is prevented at two levels: this wave hands each ticket to exactly one worker, and `work-on-issue`'s atomic claim stops any cross-wave or cross-operator collision.

Wait for the wave's workers to finish (they run in the background; you're notified on completion). Collect each result.

## Phase 4 — Keep open PRs mergeable (conflict resolution)

A PR that was fine when opened can go stale once a sibling merges. List open PRs: `gh pr list --state open --json number,headRefName,mergeable,mergeStateStatus`. For each that is `CONFLICTING` or behind `main`:

- Add a worktree on its branch (`git worktree add ../wf-<branch> <branch>`), `git fetch origin`, invoke **`/git-rebase`** (`ably-skills:git-rebase`) to rebase onto `origin/main` resolving conflicts, then `git push --force-with-lease`. Remove the temp worktree afterward (`git worktree remove`).
- If `/git-rebase` hits a conflict it can't safely resolve, comment on the PR and the ticket flagging that human help is needed, and move on — never force a bad resolution.

## End of wave

Print a concise summary: tickets moved to Done, PRs opened this wave (with URLs), PRs rebased, and what remains blocked and on whom. Then let `/loop` re-invoke for the next wave. The loop naturally stops when Phase 3 finds nothing claimable — i.e. everything is either Done or waiting on a human PR merge.
