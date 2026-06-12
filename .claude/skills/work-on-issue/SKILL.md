---
name: work-on-issue
description: Fetch a Wayfarer Jira ticket (under AIT-936), transition it to In Progress, and drive the implementation via /goal. Use when the user wants to start work on or pick up a Jira ticket.
---

Fetch a Wayfarer Jira ticket (under AIT-936) and work on it.

## Steps

### 1. Identify the ticket

Use the ticket key from the user's message (e.g. `AIT-938`). If none was given, ask: "Which ticket? (e.g. AIT-938)"

### 2. Load Jira tools

Call `searchAblyTools` with category `jira` to ensure the Jira tool schemas are loaded. You need `jiraGetIssue` and `jiraTransitionIssue`.

### 3. Fetch the ticket

Call `jiraGetIssue` (via `callAblyTool`) with:

```json
{
  "issue_key": "<key>",
  "include_comments": true
}
```

### 4. Transition to In Progress

Call `jiraTransitionIssue` (via `callAblyTool`):

```json
{
  "issue_key": "<key>",
  "transition": "In Progress"
}
```

### 5. Work on the issue

Synthesise the ticket summary, description, and comments into a goal string formatted as:

```
[BUG|FEATURE] <key>: <summary>

Context: <description>
Done when: <acceptance criteria, or inferred from description>
Notes: <relevant comments>
```

Then invoke the built-in `/goal` skill with that string as the goal. `/goal` will drive the implementation — do not start work directly.

### 6. Link the PR when done

Once a PR is raised, comment the URL on the ticket using `jiraAddComment` (via `callAblyTool`):

```json
{
  "issue_key": "<key>",
  "comment": "PR: <url>"
}
```
