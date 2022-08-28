# convert-issue-extension

WIP


#### Example Usage

```yaml
name: Add card to project

on:
  issues:
    types:
      - opened
      - edited

jobs:
  example-convert-issue-extension:
    name: example
    runs-on: ubuntu-latest
    steps:
      - uses: stNamco/convert-issue-extension@v0.0.2
        with:
          githubToken: ${{secrets.EXAMPLE_PAT}}
          issueId: ${{ github.event.issue.node_id }}
          projectNumber: 10 #example
          issueTitle: ${{ github.event.issue.title }}
          shouldSyncWithTrackedInIssue: true
```


### Action inputs

| Name | Description |
| --- | --- |
| githubToken | `repo` and `project` scoped [Personal Access Token (PAT)](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token). |
| issueId | issue node id. |
| issueTitle | issue title. if you want to do use convert-issue feature, you can input title only. so this action use the value. |
| projectNumber | github project numeber. | 
| shouldSyncWithTrackedInIssue | `true` or `false`. default `false` |
| shouldAddProjectIfNeeded | `true` or `false`. default `true` |
