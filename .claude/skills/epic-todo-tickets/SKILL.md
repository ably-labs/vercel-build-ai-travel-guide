---
name: epic-todo-tickets
description: List all tickets in the Wayfarer epic AIT-936 that are in "To Do" status (not yet started). Use when the user wants to see what work is available to pick up.
---

Find all unstarted tickets in the Wayfarer epic (AIT-936).

## Steps

### 1. Load Jira tools

Call `searchAblyTools` with category `jira` to load the Jira tool schemas. You need `jiraSearchIssues`.

### 2. Search for To Do tickets

Call `jiraSearchIssues` (via `callAblyTool`) with:

```json
{
  "jql": "project = AIT AND \"Epic Link\" = AIT-936 AND status = \"To Do\" ORDER BY priority DESC, created ASC",
  "fields": ["summary", "status", "priority", "issuetype", "assignee"]
}
```

If that returns no results (Epic Link field not available), retry with the parent field:

```json
{
  "jql": "project = AIT AND parent = AIT-936 AND status = \"To Do\" ORDER BY priority DESC, created ASC",
  "fields": ["summary", "status", "priority", "issuetype", "assignee"]
}
```

### 3. Present results

Display the results as a markdown table:

| Key | Type | Priority | Summary |
|-----|------|----------|---------|
| AIT-XXX | Bug/Story | High | ... |

Include a direct link for each key: `https://ably.atlassian.net/browse/<key>`

If there are no results, say so clearly.

### 4. Offer next step

Prompt: "Want to pick one up? Say `/work-on-issue AIT-XXX` to start."
