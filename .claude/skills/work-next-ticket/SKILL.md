---
name: work-next-ticket
description: Autonomously pick the next available To Do ticket from the Wayfarer epic (AIT-936), work it in an isolated git worktree via the work-on-issue skill, open a PR, and move the ticket forward in Jira. Designed to run under /loop so the agent clears the backlog one ticket per iteration. Use when the user wants to drain the epic backlog hands-off.
---

Pick up the next unworked Wayfarer ticket and take it all the way to an open PR — one ticket per invocation. This skill is meant to be run under `/loop` (e.g. `/loop /work-next-ticket`), where each loop iteration claims and completes a single ticket until the backlog is empty.

Each iteration is **self-contained**: claim one ticket, isolate it in a worktree, implement, open a PR, update Jira, then return so the loop can pick the next one. Do not try to do more than one ticket per invocation.

## Steps

### 1. List the available backlog

Invoke the **`epic-todo-tickets`** skill to fetch all tickets in AIT-936 currently in "To Do" status. That skill returns the candidate set — do not re-implement its query here.

If it returns no tickets, the backlog is drained: say so clearly and **stop the loop** (do not schedule another iteration). Otherwise continue.

### 2. Choose a ticket that is not already being worked on

The "To Do" filter already excludes started work, but guard against races (a parallel loop, a teammate, or a previous iteration whose transition lagged). Walk candidates in the order `epic-todo-tickets` returned them (highest priority first) and pick the **first** one for which ALL of these hold:

- **No assignee** — skip any candidate whose `assignee` field is set.
- **No local branch or worktree already claims it** — run `git worktree list` and `git branch -a`; skip the key if either already references it (branches are named `<key>-<slug>`, see step 3).
- **No open PR references it** — run `gh pr list --search "<key>" --state open`; skip if a PR already exists.
- **Still "To Do" on a fresh read** — load `jira` tools via `searchAblyTools`, then call `jiraGetIssue` (via `callAblyTool`) with `{ "issue_key": "<key>", "include_comments": true }` and confirm status is still "To Do". This is the claim check — it closes the gap between the list query and now.

If every candidate is filtered out, report that all open tickets are already being worked on and **stop the loop**.

Announce the chosen ticket before proceeding: `Claiming <key>: <summary>`.

### 3. Isolate the work in a git worktree

Create and switch into a dedicated worktree for this ticket so the implementation never touches `main` or collides with a parallel loop:

Call **`EnterWorktree`** with `name` set to `<key>-<short-slug>` (lowercase, dash-separated from the summary, e.g. `ait-941-map-pin-drift`). This branches from `origin/<default-branch>` and switches the session into the worktree. The branch name will be `<key>-<short-slug>` — the same token the step-2 guards look for.

### 4. Implement via the work-on-issue skill

Invoke the **`work-on-issue`** skill with the chosen ticket key. It will:
- transition the ticket **To Do → In Progress** in Jira,
- fetch the description and comments, and
- drive the implementation through `/goal`.

Let `work-on-issue` own the implementation — do not start coding directly. Wait for `/goal` to finish before continuing.

### 5. Open the pull request

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

### 6. Update Jira — comment the PR and advance the status

This is the part that must not be skipped. Load `jira` tools if not already loaded, then:

1. Comment the PR link on the ticket — `jiraAddComment` (via `callAblyTool`): `{ "issue_key": "<key>", "comment": "PR opened: <url>" }`
2. Transition the ticket **In Progress → In Review** — `jiraTransitionIssue` (via `callAblyTool`): `{ "issue_key": "<key>", "transition": "In Review" }`

We move to **In Review**, not Done — the PR is open but not merged. If the `In Review` transition is rejected (board uses different names), list the valid transitions and pick the closest forward state (e.g. "Review", "In Review", "Code Review"); never move it to "Done" from here, and never leave it stuck in "In Progress".

### 7. Leave the worktree and let the loop continue

Call **`ExitWorktree`** with `action: "keep"` — the branch and its open PR must survive for review, so never remove it. This returns the session to the main repository directory.

Report a one-line summary: `<key> → PR <url>, Jira moved to In Review`.

The loop will re-invoke this skill for the next ticket. Keep going until step 1 finds an empty backlog or step 2 finds nothing claimable, then stop.
