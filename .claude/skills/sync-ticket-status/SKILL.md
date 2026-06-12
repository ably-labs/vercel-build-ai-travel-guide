---
name: sync-ticket-status
description: Reconcile Wayfarer ticket status (AIT-936) with GitHub PR state. Moves In Review tickets whose PR a human merged to Done (unblocking dependents), and bounces tickets whose PR was closed-unmerged back to To Do. Runnable standalone under /loop so merges are reflected even when autopilot isn't dispatching new work. autopilot calls this as its reconcile phase.
---

Bring Jira in line with what actually happened on GitHub. This is the mechanism that turns a **human merging a PR** into the ticket automatically moving to **Done** — and it's deliberately a standalone skill so it keeps running (`/loop /sync-ticket-status`) even when no new work is being dispatched, which is exactly when tickets sit In Review waiting for a merge.

## Steps

### 1. Load tools

`searchAblyTools` category `jira` (you need `jiraSearchIssues`, `jiraGetIssue`, `jiraTransitionIssue`, `jiraCreateUpdateIssue`, `jiraAddComment`). Ensure `gh` is authenticated.

### 2. Find tickets awaiting a merge decision

`jiraSearchIssues`: `project = AIT AND parent = AIT-936 AND status = "In Review"`, fields `["summary","status"]`. These are the tickets with an open-or-recently-closed PR whose outcome may not yet be reflected in Jira.

If there are none, report "nothing to reconcile" and stop.

### 3. Resolve each ticket against its PR

For each In Review ticket, find its PR — the PR title is `<key>: …` and the body says `Closes <key>`:

```bash
gh pr list --search "<key>" --state all --json number,state,url,mergedAt,headRefName
```

Then act on the PR's state:

- **MERGED** (a human merged it) → move the ticket to **Done**:
  `jiraTransitionIssue { "issue_key": "<key>", "transition": "Done", "resolution": "Fixed", "comment": "PR merged: <url>" }`.
  Then clean up the local branch/worktree if present: `git worktree prune`, and `git branch -d <branch>` (it's safe — the work is merged). Moving the ticket to Done is what releases anything blocked by it.
- **CLOSED without merging** (rejected) → bounce it back to **To Do** so it re-enters the pool:
  `jiraTransitionIssue { "issue_key": "<key>", "transition": "To Do" }`, clear the assignee `jiraCreateUpdateIssue { "issue_key": "<key>", "assignee": "unassigned" }`, and `jiraAddComment` noting the PR was closed unmerged.
- **OPEN** → still under review; leave it untouched.
- **No PR found** → the ticket is In Review but has no PR (a worker likely died after transitioning). Comment and bounce it back to To Do + unassign so it gets re-picked.

If the `Done` / `To Do` transition name is rejected (board uses different names), call the issue's available transitions and pick the matching terminal/backlog state; never guess a wrong one.

### 4. Report

Summarise: which tickets moved to Done (with PR URLs), which were bounced back to To Do, and which remain In Review awaiting a human merge. Under `/loop`, keep running so the next merge is caught; stop only once no tickets remain In Review.
