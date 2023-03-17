import * as core from '@actions/core'
import * as github from '@actions/github';

const AppConstant = {
  TRACKED_IN_ISSUE_TITLE_FILED_NAME: "tracked in issue title",
}

class GithubFieldValueToken {
  fieldName: string;
  val: any;

  constructor(name: string, val: any) {
      this.fieldName = name;
      this.val = val;
  };
}

class GithubLabelValueToken {
  labelName: string;

  constructor(name: string) {
      this.labelName = name;
  };
}

interface TokenizeResult {
  fieldTokens: GithubFieldValueToken[];
  labelTokens: GithubLabelValueToken[];
}

// Labelのtokenizeも検討しているが後回し。むしろいらないかも。
function tokenize(input: string): TokenizeResult {

  function tokenizeField(input: string): GithubFieldValueToken[] {
    const tokens: GithubFieldValueToken[] = [];
    const result = input.match(/\(.+?:.+?\)/giu);
    for (var v of result ?? []) {
        let d = v.slice(1).slice(0, -1).split(':');
        tokens.push(new GithubFieldValueToken(d![0], d![1]));
    }
    return tokens;
  }

  function tokenizeLabel(input: string): GithubLabelValueToken[] {
    const tokens: GithubLabelValueToken[] = [];
    const result = input.match(/\[.+?\]/giu);
    for (var v of result ?? []) {
        tokens.push(new GithubLabelValueToken(v.slice(1).slice(0, -1)));
    }
    return tokens;
  }

  return {
      fieldTokens: tokenizeField(input),
      labelTokens: tokenizeLabel(input)
  }
}


const ProjectV2FieldDataType = {
  TEXT: 'TEXT',
  NUMBER: 'NUMBER'
}
type ProjectV2FieldDataType = typeof ProjectV2FieldDataType[keyof typeof ProjectV2FieldDataType];

interface ProjectCardField {
  nodeId: string;
  valueToken: GithubFieldValueToken
  type: ProjectV2FieldDataType;
}

interface ProjectV2ItemNodeContent {
  nodeId: string;
}

interface ProjectV2ItemEdge {
  nodeId: string;
  content: ProjectV2ItemNodeContent;
  cursor: string;
}

interface ProjectV2CardInfo {
  projectNodeId: string;
  item: ProjectV2ItemEdge;
  trackedInIssue: TrackedInIssue | undefined;
  labels: string[] | undefined;
}

interface TrackedInIssue {
  title: string;
  issueNumber: number;
  milestoneNumber: number | undefined;
}

interface IssueInputField {
  milestoneNumber: number | undefined;
  labels: string[] | undefined;
}

async function addIssueToProject(projectNumber: number, contentId: string): Promise<string> {

  async function getProjectInfo(projectNumber: number): Promise<string> {
    const repositoryOwnerName = github.context.payload.repository!.owner.login;
    const ownerType = github.context.payload.repository!.owner.type.toLowerCase();

    const res: any = await octokit.graphql(
      `query getProject($repositoryOwnerName: String!, $projectNumber: Int!) {
        ${ownerType}(login: $repositoryOwnerName) {
          projectV2(number: $projectNumber) {
            id
          }
        }
      }`,
      {
        repositoryOwnerName,
        projectNumber
      }
    )
    return res[ownerType]!.projectV2.id;
  }

  const projectId = await getProjectInfo(projectNumber);
  const res = await octokit.graphql(
    `mutation addIssueToProject($input: AddProjectV2ItemByIdInput!) {
      addProjectV2ItemById(input: $input) {
        item {
          id
        }
      }
    }`,
    {
      input: {
        projectId,
        contentId
      }
    }
  )
  return projectId;
}

async function getProjectCardInfo(issueNodeId: string, projectNumber: number, shouldSyncWithTrackedInIssue: boolean): Promise<ProjectV2CardInfo | undefined> {

  let trackedInIssue: TrackedInIssue | undefined = undefined;
  let labels: string[] | undefined = undefined;

  async function fetchCardInfo(issueNodeId: string, projectNumber: number, cursor?: string, withTrackedInIssue = false, withLabel = false): Promise<{
    items: ProjectV2ItemEdge[],
    projectV2NodeId: string,
    itemPageLimit: number,
    trackedInIssue: TrackedInIssue | undefined,
    labels: string[] | undefined
  } | undefined> {
    // TODO: cardのデータどうとるのがいいかは今後検討。まずは動くものを作る。
    let res: any = undefined;
    try {
      res = await octokit.graphql(
        `
        query getCardInfo($issueNodeId: ID!, $projectNumber: Int!, $withTrackedInIssue: Boolean!, $cursor: String, $withLabel: Boolean!) {
          node(id: $issueNodeId) {
          ... on Issue {
              id
              number
              title
              labels(first: 10) @include(if: $withLabel) {
                nodes {
                  name
                }
              }
              projectV2(number: $projectNumber) {
                id
                title
                items(first: 100, after: $cursor) {
                  totalCount
                  edges {
                    cursor
                    node {
                      id
                      content {
                        ... on Issue {
                          id
                          title
                        }
                      }
                    }
                  }
                }
              }
              trackedInIssues(first: 10) @include(if: $withTrackedInIssue) {
                edges {
                  node {
                    title
                    number
                    milestone {
                      id
                      number
                    }
                  }
                }
              }
            }
          }
        }
        `,
        {
          issueNodeId,
          projectNumber,
          withTrackedInIssue,
          cursor,
          withLabel
        }
      );
    } catch (e) {
      return undefined;
    }

    if (!res.node.projectV2) {
      return undefined;
    }

    const projectV2ItemEdges = res.node.projectV2.items.edges.reduce((acc: ProjectV2ItemEdge[], v: any): ProjectV2ItemEdge[] => {
      acc.push({
        nodeId: v.node.id,
        content: {
          nodeId: v.node.content.id
        },
        cursor: v.cursor,
      })
      return acc;
    }, []);

    
    if (withTrackedInIssue && res?.node?.trackedInIssues?.edges.length > 0 && !trackedInIssue) {
      // NOTE: 一旦TrackedInIssuesは1つとして実装する。
      const edge = res?.node?.trackedInIssues?.edges[0];
      trackedInIssue = {
        title: edge.node.title,
        issueNumber: edge.node.number,
        milestoneNumber: edge.node.milestone ? edge.node.milestone.number : undefined,
      };
    }

    
    if (withTrackedInIssue && res?.node?.labels?.nodes.length > 0 && !labels) {
      labels = res!.node!.labels!.nodes.reduce((acc: string[], v: any): string[] => {
        acc.push(v.name);
        return acc;
      }, []);
    }

    return {
      items: projectV2ItemEdges,
      projectV2NodeId: res.node.projectV2.id,
      itemPageLimit: Math.ceil(res.node.projectV2.items.totalCount / 100),
      trackedInIssue: trackedInIssue,
      labels: labels
    }
  }

  let info = await fetchCardInfo(issueNodeId, projectNumber, undefined, shouldSyncWithTrackedInIssue, true);
  let projectV2NodeId: string;

  if (info === undefined) {
    if (shouldAddProjectIfNeeded) {
      projectV2NodeId = await addIssueToProject(projectNumber, issueNodeId);
      info = await fetchCardInfo(issueNodeId, projectNumber, undefined, shouldSyncWithTrackedInIssue);
    } else {
      core.setFailed("there is no project which is related to this issue");
    }
  } else {
    projectV2NodeId = info.projectV2NodeId;
  }

  let item = info!.items.find((ele: ProjectV2ItemEdge) => ele.content.nodeId === issueNodeId);
  let itemPage = 0;

  while (item === undefined && itemPage <= info!.itemPageLimit) {
    const _item = info!.items.find((ele: ProjectV2ItemEdge) => ele.content.nodeId === issueNodeId) as ProjectV2ItemEdge;
    info = await fetchCardInfo(issueNodeId, projectNumber, info!.items.pop()?.cursor);
    item = _item;
    itemPage += 1;
  }

  if (item === undefined) {
    core.setFailed('there is no card which is related to this issue');
  }

  const card: ProjectV2CardInfo = {
    projectNodeId: projectV2NodeId!,
    item: item!,
    trackedInIssue: info!.trackedInIssue,
    labels: info!.labels
  };

  return card;
}

async function createProjectCardFields(issueNodeId: string, projectNumber: number, fieldValueTokens: GithubFieldValueToken[]): Promise<ProjectCardField[]> {

  async function fetchField(issueNodeId: string, projectNumber: number, fieldName: string): Promise<any> {
    // TODO: fieldのデータどうとるのがいいかは今後検討。まずは動くものを作る。
    return await octokit.graphql(
      `
      query fetchField($issueNodeId: ID!, $projectNumber: Int!, $fieldName: String!) {
        node(id: $issueNodeId) {
            ... on Issue {
              id
              title
              projectV2(number: $projectNumber) {
                title
                id
                field(name: $fieldName) {
                  ... on ProjectV2Field {
                    id
                    name
                    dataType
                  }
                }
              }
            }
          }
      }
      `,
      {
        issueNodeId,
        projectNumber,
        fieldName
      }
    );
  }

  let tmpDict: {[key: string]: GithubFieldValueToken} = {};
  const tasks = fieldValueTokens.reduce((acc: Promise<any>[], v: GithubFieldValueToken): Promise<any>[] => {
    tmpDict[v.fieldName] = v;
    acc.push(fetchField(issueNodeId, projectNumber, v.fieldName));
    return acc;
  }, []);

  let output: ProjectCardField[] = [];
  await Promise.all(tasks)
    .then((res) => {    
      output = res.reduce((acc: ProjectCardField[], v: any): ProjectCardField[] => {
        if (v.node.projectV2.field !== undefined) {
          const f = v.node.projectV2.field;
          acc.push({nodeId: f.id, valueToken: tmpDict[f.name], type: f.dataType});
        }
        return acc;
      }, []);
  });

  return output;
}

// https://docs.github.com/ja/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects#updating-a-custom-text-number-or-date-field
// NOTE: supported field data type are STRING and NUMBER for now.
async function updateCustomField(cardField: ProjectCardField, projectId: string, cardNodeId: string): Promise<void> {

  return new Promise(async (resolve, reject) => {
    const fieldId = cardField.nodeId;
    const value = cardField.type == ProjectV2FieldDataType.NUMBER ? parseFloat(cardField.valueToken.val):cardField.valueToken.val;
    const valueDataType = cardField.type.toLowerCase();
    const valueQueryType = cardField.type == ProjectV2FieldDataType.NUMBER ? "Float!":"String!";
    await octokit.graphql(
      `
      mutation($projectId:ID!, $cardNodeId: ID!, $fieldId: ID!, $value: ${valueQueryType}) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId
            itemId: $cardNodeId
            fieldId: $fieldId
            value: {
              ${valueDataType}: $value
            }
          }
        ) {
          projectV2Item {
            id
          }
        }
      }
      `,
      {
        projectId,
        cardNodeId,
        fieldId,
        value
      }
    );
    resolve();
  })
}

// https://docs.github.com/ja/rest/issues/issues#update-an-issue
async function updateIssue(input: IssueInputField) {
  const repositoryOwnerName = github.context.payload.repository?.owner.login;
  const issueRepository = github.context.payload.repository?.name;
  const issueNumber = github.context.payload.issue?.number;

  await octokit.request(`PATCH /repos/${repositoryOwnerName}/${issueRepository}/issues/${issueNumber}`, {
    milestone: input.milestoneNumber,
    labels: input.labels
  });
}


async function main() {
  // step1: titleからfieldなどの情報をtokenizeする
  const tokens = tokenize(issueTitle);

  // step2: ProjectV2の情報を取得
  const card = await getProjectCardInfo(issueId, projectNumber, shouldSyncWithTrackedInIssue);
  const projectId = card!.projectNodeId;
  const cardNodeId = card!.item.nodeId;

  // step3: 情報を更新
  // step3-1: fieldを更新
  let fieldTokens: GithubFieldValueToken[] = Array.from(tokens.fieldTokens);
  // NOTE: shouldSyncWithTrackedInIssueがtrueの場合、更新するfieldを追加する
  if (shouldSyncWithTrackedInIssue && card?.trackedInIssue !== undefined) {
    fieldTokens.push({
      fieldName: AppConstant.TRACKED_IN_ISSUE_TITLE_FILED_NAME,
      val: `#${card!.trackedInIssue!.issueNumber} ${card!.trackedInIssue!.title}`
    });
  }
  if (fieldTokens.length > 0) {
    // NOTE: 現状fieldの更新しか実装してないので下記のような実装をしている。
    const projectCardFields = await createProjectCardFields(issueId, projectNumber, fieldTokens);
    const tasks = projectCardFields.reduce((acc: Promise<void>[], f: ProjectCardField): Promise<void>[] => {
      acc.push(updateCustomField(f, projectId!, cardNodeId!));
      return acc;
    }, []);

    await Promise.all(tasks);
  }

  // step3-2: issueを更新    
  const tokenLabels = tokens.labelTokens.reduce((acc: string[], v: GithubLabelValueToken) => {
    acc.push(v.labelName);
    return acc;
  }, []);
  const labelSet = new Set(tokenLabels.concat(card!.labels ?? []));
  const labels = [...labelSet];
  await updateIssue({
    milestoneNumber:  card?.trackedInIssue?.milestoneNumber,
    labels: labels.length > 0 ? labels: undefined
  });


  // exit
  core.setOutput('cardNodeId', card!.item.nodeId);
}

const ghToken = core.getInput('githubToken', {required: true});
const octokit = github.getOctokit(ghToken);
const issueId = core.getInput('issueId', {required: true});
const projectNumber = parseInt(core.getInput('projectNumber', {required: true}));
const issueTitle = core.getInput('issueTitle', {required: true});
const shouldSyncWithTrackedInIssue = core.getInput('shouldSyncWithTrackedInIssue', {required: false}) === "true";
const shouldAddProjectIfNeeded = core.getInput('shouldAddProjectIfNeeded', {required: false}) === "true";

main();