---
name: work-next-ticket
description: Autonomously pick the next available To Do ticket from the Wayfarer epic (AIT-936), work it in an isolated git worktree via the work-on-issue skill, open a PR, and move the ticket forward in Jira. Designed to run under /loop so the agent clears the backlog one ticket per iteration. Use when the user wants to drain the epic backlog hands-off.
---

Pick up the next unworked Wayfarer ticket and take it all the way to an open PR — one ticket per invocation. This skill is meant to be run under `/loop` (e.g. `/loop /work-next-ticket`), where each loop iteration claims and completes a single ticket until the backlog is empty.

Each iteration is **self-contained**: refresh the dependency graph, claim one ticket, isolate it in a worktree, implement, open a PR, update Jira, then return so the loop can pick the next one. Do not try to do more than one ticket per invocation.

## Steps

### 1. List the available backlog

Invoke the **`epic-todo-tickets`** skill to fetch all tickets in AIT-936 currently in "To Do" status. That skill returns the candidate set — do not re-implement its query here.

If it returns no tickets, the backlog is drained: say so clearly and **stop the loop** (do not schedule another iteration). Otherwise continue.

### 2. Establish the dependency graph

Before picking anything, work out how the open tickets relate and **record that relationship in Jira**, so every loop iteration and every parallel worker reads one consistent graph instead of re-deriving it inconsistently. **The agent determines the relationships — never ask a human to declare them.**

Why this matters: each worktree branches from `origin/main`, so a ticket can only see code that has already merged. A ticket that needs another's change therefore cannot be started until that other ticket is merged. Getting the graph right is what separates "safe to run in parallel" from "must wait".

1. **Gather context.** Take the To Do candidates from step 1, plus any unmerged work they might build on — the epic's In Progress / In Review tickets and recently Done ones. Load `jira` tools via `searchAblyTools`, then fetch each candidate's description and existing links with `jiraGetIssue` (via `callAblyTool`): `{ "issue_key": "<key>", "include_comments": true, "fields": ["status", "assignee", "description", "issuelinks"] }`.

2. **Reason about real dependencies.** Ticket B depends on ticket A when B needs A's change to build, pass, or make sense — e.g. B extends an API/component/schema/migration that A introduces, B's description references A's key ("after AIT-940 lands"), or both touch the same surface in an order that matters. Be **conservative**: assert a dependency only when you can justify it from ticket content. Cosmetic or coincidental overlap is not a dependency. When genuinely unsure, leave the tickets independent (parallel-safe) rather than over-serializing — over-serializing needlessly starves the parallel loops.

3. **Record each genuine dependency as a Jira link, idempotently.** If B is blocked by A and no such link already exists, call `jiraCreateIssueLink` (via `callAblyTool`) with:

   ```json
   {
     "inward_issue": "<B, the blocked ticket>",
     "outward_issue": "<A, the blocker>",
     "link_type": "Blocks",
     "comment": "Auto-detected: <B> needs <A> merged first — <one-line reason>."
   }
   ```

   With `link_type: "Blocks"`, the outward issue *blocks* the inward issue, i.e. the inward issue *is blocked by* the outward one. **Skip the call if the link already exists** (you saw the candidate's `issuelinks` in step 1 of this section) — never create duplicates.

The result: the parallel-vs-serial decision is now encoded in Jira, and step 3's selection guard just reads it.

### 3. Choose a ticket that is not already being worked on

Walk candidates in the order `epic-todo-tickets` returned them (highest priority first) and pick the **first** one for which ALL of these hold. The first four guard against races (a parallel loop, a teammate, or a previous iteration whose transition lagged); the last enforces the dependency graph from step 2.

- **No assignee** — skip any candidate whose `assignee` field is set.
- **No local branch or worktree already claims it** — run `git worktree list` and `git branch -a`; skip the key if either already references it (branches are named `<key>-<slug>`, see step 4).
- **No open PR references it** — run `gh pr list --search "<key>" --state open`; skip if a PR already exists.
- **Still "To Do" on a fresh read** — re-confirm via `jiraGetIssue` that status is still "To Do". This closes the gap between the list query and now.
- **Every blocker already merged to `main`.** From the candidate's `issuelinks`, find inward `is blocked by` links. The candidate is claimable only if **every** blocker is `Done` (its PR has merged). A blocker sitting in "In Progress" or "In Review" means the dependency is *not yet in `main`* — skip the candidate this iteration. Outward `blocks` links don't constrain the candidate itself; ignore them for selection. No links → independent and parallel-safe.

If every candidate is filtered out, report **why** — all claimed, or all remaining candidates are blocked by unmerged dependencies — and **stop the loop**. If the only reason is unmerged dependencies, say so explicitly: those tickets become claimable once their blockers' PRs merge, so a future loop iteration will pick them up. (Because this skill leaves tickets in *In Review* rather than Done, a dependency chain won't fully drain in one pass — it advances by one merge at a time.)

Announce the chosen ticket before proceeding: `Claiming <key>: <summary>`.

### 4. Isolate the work in a git worktree

Create and switch into a dedicated worktree for this ticket so the implementation never touches `main` or collides with a parallel loop:

Call **`EnterWorktree`** with `name` set to `<key>-<short-slug>` (lowercase, dash-separated from the summary, e.g. `ait-941-map-pin-drift`). This branches from `origin/<default-branch>` and switches the session into the worktree. The branch name will be `<key>-<short-slug>` — the same token the step-3 guards look for.

### 5. Implement via the work-on-issue skill

Invoke the **`work-on-issue`** skill with the chosen ticket key. It will:
- transition the ticket **To Do → In Progress** in Jira,
- fetch the description and comments, and
- drive the implementation through `/goal`.

Let `work-on-issue` own the implementation — do not start coding directly. Wait for `/goal` to finish before continuing.

### 6. Open the pull request

Once the work is committed on the worktree branch, push and open a PR against the default branch:

```bash
git push -u origin <branch>
gh pr create --base main --head <branch> \
  --title "<key>: <summary>" \
  --body "$(cat <<'EOF'
Closes <key>.

## What
<one-paragraph summary of the change>

## Ticket
https://ably.atlassian.net/browse/<key>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR URL from the command output.

### 7. Update Jira — comment the PR and advance the status

This is the part that must not be skipped. Load `jira` tools if not already loaded, then:

1. Comment the PR link on the ticket — `jiraAddComment` (via `callAblyTool`): `{ "issue_key": "<key>", "comment": "PR opened: <url>" }`
2. Transition the ticket **In Progress → In Review** — `jiraTransitionIssue` (via `callAblyTool`): `{ "issue_key": "<key>", "transition": "In Review" }`

We move to **In Review**, not Done — the PR is open but not merged. If the `In Review` transition is rejected (board uses different names), list the valid transitions and pick the closest forward state (e.g. "Review", "In Review", "Code Review"); never move it to "Done" from here, and never leave it stuck in "In Progress".

### 8. Leave the worktree and let the loop continue

Call **`ExitWorktree`** with `action: "keep"` — the branch and its open PR must survive for review, so never remove it. This returns the session to the main repository directory.

Report a one-line summary: `<key> → PR <url>, Jira moved to In Review`.

The loop will re-invoke this skill for the next ticket. Keep going until step 1 finds an empty backlog or step 3 finds nothing claimable, then stop.
