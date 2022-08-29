# convert-issue-extension

if you want to use convert-issue feature, you can input title only. so this action enable to update some data. which can be done by fetching some data using title and some node data.






https://user-images.githubusercontent.com/11131753/187097269-fd847293-88f2-434c-91b5-9d19cde2e68b.mp4



#### Features
- add issue to project automatically.
- sync data the issue and the tracked-in-issue.
  - milesotne 
  - requirements
    - you need to add text type field `tracked in issue title` to project.
- update project card field, if you write the title based on specified style.
  - `($field-name:$field-value)example..` 
  - requirements
    - you need to add field `$field-name` to project.
    ※ supported type are number and text currently.
- update issue labels, if you write the title based on specified style.
  - `[label]example..` 


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
| (optional)shouldSyncWithTrackedInIssue | `true` or `false`. default `false` |
| (optional)shouldAddProjectIfNeeded | `true` or `false`. default `true` |
