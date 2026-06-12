Use the Ably MCP Jira tools to file a bug or feature request under the Wayfarer epic (AIT-936).

## Steps

### 1. Gather details

If the user's message already contains enough detail, extract what you need and skip asking. Otherwise collect:

- **Title** — one-line summary
- **Type** — Bug or Feature
- **Description** — what's wrong / what's wanted; for bugs include steps to reproduce and expected vs actual behaviour
- **Priority** — Blocker / Critical / High / Medium / Low (default: Medium)

### 2. Load Jira tools

Call `searchAblyTools` with category `jira` to load the Jira tool schemas before calling them. You need `jiraCreateUpdateIssue`.

### 3. Create the ticket

Call `jiraCreateUpdateIssue` (via `callAblyTool`) with:

```json
{
  "project": "AIT",
  "issue_type": "Bug",
  "summary": "<title>",
  "description": "<description>",
  "priority": "Medium",
  "parent": "AIT-936"
}
```

Use `issue_type: "Bug"` for bugs and `issue_type: "Story"` for features. Adjust `priority` to what the user specified.

### 4. Confirm

Report back with:
- The ticket key (e.g. `AIT-938`)
- Direct link: `https://ably.atlassian.net/browse/<key>`
