---
name: rebase-stale-prs
description: Keep open Wayfarer PRs (AIT-936) mergeable. Finds open PRs that have fallen behind or now conflict with main because other PRs landed ahead of them, rebases each onto origin/main via /git-rebase (resolving conflicts), and force-pushes with --force-with-lease. Runnable standalone under /loop; autopilot calls this as its PR-maintenance phase.
---

When a PR merges to `main`, every other open PR is now behind it and may conflict. This skill brings those stale PRs back up to date automatically so they stay mergeable, without waiting for the author. Run it standalone (`/loop /rebase-stale-prs`) or let `autopilot` call it each wave.

## Steps

### 1. Refresh and list open PRs

```bash
git fetch origin
gh pr list --base main --state open --json number,title,headRefName,mergeable,mergeStateStatus,url
```

Consider only this workflow's PRs — title starts with an `AIT-` key (branch named `<key>-<slug>`). Ignore anything else.

### 2. Pick the stale ones

A PR is **stale** (something landed ahead of it) when `mergeStateStatus` is `BEHIND` (head is behind `main`) or `DIRTY`, or `mergeable` is `CONFLICTING`. Skip PRs that are `CLEAN` / up to date — rebasing them would churn force-pushes for nothing.

If none are stale, report "all open PRs current" and stop.

### 3. Rebase each stale PR onto the latest main

Do each PR in its own checkout so concurrent work never collides (when several are stale you may run these as parallel background `Agent`s with `isolation: "worktree"`, one per PR — same pattern as autopilot's workers):

1. Get the branch into a dedicated worktree:
   ```bash
   git worktree add /tmp/wf-<branch> <branch> 2>/dev/null \
     || git worktree add -B <branch> /tmp/wf-<branch> origin/<branch>
   ```
2. From inside that worktree (`git fetch origin` first), invoke the **`/git-rebase`** skill (`ably-skills:git-rebase`) to rebase the branch onto `origin/main`; it resolves conflicts step by step.
3. On success: `git push --force-with-lease` (safe — it refuses if someone else pushed meanwhile), then `git worktree remove /tmp/wf-<branch> --force`.
4. If `/git-rebase` hits a conflict it cannot safely resolve, abort the rebase, leave the branch as-is, and `jiraAddComment` on the ticket + comment on the PR flagging that a human rebase is needed. Remove the worktree. **Never force a bad resolution** just to make it mergeable.

### 4. Report

Summarise: PRs rebased and force-pushed (with URLs), PRs that needed human help (with reason), and PRs already current. Under `/loop`, keep running so the next merge's stale siblings get refreshed; stop when there are no open PRs at all.
