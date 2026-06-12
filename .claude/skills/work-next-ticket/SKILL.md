---
name: work-next-ticket
description: Take one Wayfarer ticket (AIT-936) from claim to open PR — self-selecting the next available one, or working a key passed by the autopilot orchestrator. Isolates in a git worktree, implements via work-on-issue, rebases onto origin/main, opens a PR, and moves the ticket to In Review. Parallel-safe: many copies can run at once without colliding. Use for a single ticket; use autopilot to drain the backlog in parallel.
---

Carry **one** ticket all the way to an open PR. Safe to run many at once (the autopilot orchestrator does exactly that), because claiming is atomic and each run works in its own branch/worktree.

Two entry modes:
- **Key passed in** (e.g. dispatched by `autopilot`, or `/work-next-ticket AIT-941`): skip discovery, go straight to step 4 for that key.
- **No key**: self-select the next claimable ticket via steps 1–3.

## Steps

### 1. List the available backlog

Invoke the **`epic-todo-tickets`** skill to fetch AIT-936 tickets in "To Do". If none, the backlog is drained — say so and **stop the loop**.

### 2. Ensure the dependency graph is current

Selection depends on knowing which tickets block which. **If you were dispatched by `autopilot`, it has already refreshed the graph for the whole backlog this wave — skip to step 3.** Otherwise refresh it yourself:

- Load `jira` tools, fetch each candidate's `description` and `issuelinks` (`jiraGetIssue` with `fields: ["status","assignee","description","issuelinks"]`), plus the epic's In Progress / In Review / recently-Done tickets they might build on.
- **The agent infers relationships — never ask a human.** Ticket B depends on A when B needs A's change to build, pass, or make sense (extends an API/schema/migration A introduces, references A's key in prose, or shares a surface where order matters). Be conservative: assert only what the ticket content justifies; when unsure, leave them independent rather than over-serialising.
- Record each genuine, not-yet-linked dependency idempotently via `jiraCreateIssueLink`: `{ "inward_issue": "<B, blocked>", "outward_issue": "<A, blocker>", "link_type": "Blocks", "comment": "Auto-detected: <B> needs <A> merged first — <reason>." }`. With `Blocks`, the outward issue blocks the inward one. Skip if the link already exists.

### 3. Select the next claimable ticket

Walk candidates in priority order; pick the **first** for which ALL hold:

- **No assignee** set.
- **Not already claimed by a branch anywhere** — `git ls-remote --heads origin "<key>-*"` is empty, and `git worktree list` / `git branch -a` don't reference it (branches are `<key>-<slug>`).
- **No open PR** — `gh pr list --search "<key>" --state open` is empty.
- **Every blocker merged to `main`** — from `issuelinks`, each inward `is blocked by` link's blocker is `Done`. A blocker in In Progress/In Review is *not yet in `main`* → skip this candidate. No links → independent, parallel-safe.

If nothing is claimable, report **why** (all claimed, or all remaining blocked by unmerged work) and **stop the loop** — blocked tickets become claimable once their blockers' PRs merge, which a later wave handles. Otherwise announce `Claiming <key>: <summary>` and continue.

### 4. Isolate the work

You need a dedicated branch named `<key>-<short-slug>` (lowercase, e.g. `ait-941-map-pin-drift`) off the latest `origin/main`.

- **If you are already in an isolated working copy** (an `autopilot`-dispatched worker runs in its own worktree): `git fetch origin && git checkout -b <key>-<short-slug> origin/main`.
- **Otherwise** (interactive / main session): call **`EnterWorktree`** with `name: "<key>-<short-slug>"`. This branches from `origin/main` and switches into the worktree.

### 5. Claim and implement via work-on-issue

Invoke the **`work-on-issue`** skill with `<key>`. It atomically claims the ticket (transition → In Progress + assign, with race verification) and drives `/goal` to implement and commit.

If `work-on-issue` reports `lost claim on <key>`, another worker beat us: abandon this branch/worktree (no PR), and — if self-selecting (no key passed) — return to step 3 for the next candidate. If a key was passed, just stop; the orchestrator will not redispatch it.

### 6. Rebase onto the latest main — keep the PR mergeable

Sibling tickets may have merged while we worked. Before pushing:

```bash
git fetch origin
```

Then invoke the **`/git-rebase`** skill (`ably-skills:git-rebase`) to rebase the current branch onto `origin/main`; it resolves conflicts step by step. If it cannot (genuine semantic conflict it can't safely resolve), comment the blocker on the ticket via `jiraAddComment` and **stop** — leave the ticket In Progress for a human, rather than opening a broken PR.

### 7. Open the pull request

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

Capture the PR URL.

### 8. Advance Jira to In Review

Load `jira` tools if needed, then:
1. `jiraAddComment`: `{ "issue_key": "<key>", "comment": "PR opened: <url>" }`
2. `jiraTransitionIssue`: `{ "issue_key": "<key>", "transition": "In Review" }`

**In Review, not Done** — the PR is open but unmerged; `autopilot` moves it to Done after a human merges it. If `In Review` is rejected, list valid transitions and pick the closest forward state (e.g. "Review", "Code Review"); never jump to Done, never leave it stuck in In Progress.

### 9. Finish

If you used `EnterWorktree`, call **`ExitWorktree`** with `action: "keep"` (the branch + PR must survive for review). A dispatched worker just ends — its worktree is cleaned up by the harness, the pushed branch persists.

Report: `<key> → PR <url>, Jira moved to In Review`.

If self-selecting under a loop, the next invocation picks the next ticket; stop when step 1 is empty or step 3 finds nothing claimable.
