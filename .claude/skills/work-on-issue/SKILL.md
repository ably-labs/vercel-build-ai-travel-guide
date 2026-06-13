---
name: work-on-issue
description: Building block — atomically claim a Wayfarer Jira ticket (under AIT-936) and implement it on the current branch (via /goal when run interactively, otherwise directly). Claims by transitioning to In Progress and assigning the operator, then verifies it won the race so parallel workers never double-claim. Used by work-next-ticket; can also be run directly to start one ticket.
---

Claim a Wayfarer ticket (under AIT-936) and implement it on the **current branch**. This is a building block: it does not manage worktrees, open PRs, or move the ticket past In Progress — its caller (`work-next-ticket`) owns those. Running it directly implements the ticket but stops short of a PR; use `work-next-ticket` for the full pipeline.

## Steps

### 1. Identify the ticket

Use the ticket key passed to the skill (e.g. `AIT-938`). If none was given, ask: "Which ticket? (e.g. AIT-938)".

### 2. Load Jira tools

Call `searchAblyTools` with category `jira` to ensure the Jira schemas are loaded. You need `jiraGetIssue`, `jiraTransitionIssue`, and `jiraCreateUpdateIssue`.

### 3. Fetch the ticket

Call `jiraGetIssue` (via `callAblyTool`): `{ "issue_key": "<key>", "include_comments": true }`.

### 4. Claim it atomically — this is the duplicate-work guard

Claiming must happen **before** any implementation so that parallel workers (and other operators) never work the same ticket twice:

1. If the ticket is already **In Progress and assigned to `mike.christensen@ably.com`**, we are resuming our own work — skip to step 5.
2. If it is **In Progress assigned to someone else**, or already **In Review / Done**, someone else owns it. **Stop** and report `lost claim on <key>` so the caller can pick a different ticket.
3. Otherwise claim it:
   - `jiraTransitionIssue`: `{ "issue_key": "<key>", "transition": "In Progress", "comment": "Claimed by autopilot." }`
   - `jiraCreateUpdateIssue`: `{ "issue_key": "<key>", "assignee": "mike.christensen@ably.com" }`
   - **Re-read** with `jiraGetIssue` and confirm status is `In Progress` and assignee is us. If either is not, another worker won the race between our read and write — **stop** and report `lost claim on <key>`.

Transitioning to In Progress also removes the ticket from the "To Do" pool that `epic-todo-tickets` returns, so it disappears from every other worker's candidate list.

### 5. Implement

Synthesise the summary, description, and comments into a goal string:

```
[BUG|FEATURE] <key>: <summary>

Context: <description>
Done when: <acceptance criteria, or inferred from description>
Notes: <relevant comments>
```

**`/goal` is a UI-only command — a dispatched/non-interactive subagent cannot invoke it via the Skill tool.** If you are running interactively and `/goal` is available, drive it with that string; it implements and commits on the current branch. Otherwise — the normal case for an `autopilot`-dispatched worker — **do not spin trying to call `/goal` first**: implement the ticket directly on the current branch, following existing codebase patterns and the conventions in `AGENTS.md` (read the relevant `node_modules/next/dist/docs/` guide before touching Next.js code). Use the goal string above purely as your own framing of scope and "done when".

Either way, commit the work on the current branch, but do **not** open a PR or change the Jira status here — return control to the caller once the implementation is committed.
