import * as core from '@actions/core'
import * as github from '@actions/github';

const TokenKind = {
    LABEL: 1, // MEMO: Labelのtokenizeも検討しているが後回し。むしろいらないかも。
    CARD_FIELD: 2,
}
type TokenKind = typeof TokenKind[keyof typeof TokenKind];

interface GithubValueToken {
  kind: TokenKind;
}
class GithubFieldValueToken implements GithubValueToken {
    kind: TokenKind;
    fieldName: string;
    val: any;

    constructor(kind: TokenKind, name: string, val: any) {
        this.kind = kind;
        this.fieldName = name;
        this.val = val;
    };
}

// Labelのtokenizeも検討しているが後回し。むしろいらないかも。
function tokenize(input: string): GithubValueToken[] {
  const result = input.match(/\(.+?:.+?\)/giu);
  const tokens: GithubValueToken[] = [];
  
  // MEMO: 現状fieldのみ実装
  for (var v of result ?? []) {
      let d = v.slice(1).slice(0, -1).split(':');
      tokens.push(new GithubFieldValueToken(TokenKind.CARD_FIELD, d![0], d![1]));
  }
  return tokens;
}

interface ProjectCardField {
  nodeId: string;
  valueToken: GithubFieldValueToken
}

interface ProjectV2Field {
  nodeId: string;
  name: string;
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
  item: ProjectV2ItemEdge
}

async function getProjectCardInfo(issueNodeId: string, projectNumber: number): Promise<ProjectV2CardInfo | undefined> {
  let projectV2: any;
  let itemPageLimit: number = 1; // MEMO: 1pageはあるものとする。

  async function fetchCardInfo(issueNodeId: string, projectNumber: number, cursor?: string): Promise<ProjectV2ItemEdge[]> {
    // TODO: cardのデータどうとるのがいいかは今後検討。まずは動くものを作る。
    const res: any = await octokit.graphql(
      `
      query getCardInfo($issueNodeId: ID!, $projectNumber: Int!, $cursor: String) {
        node(id: $issueNodeId) {
        ... on Issue {
          id
          number
          title
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
          }
        }
      }
      `,
      {
        issueNodeId,
        projectNumber,
        cursor
      }
    );

    projectV2 = res.node.projectV2;
    itemPageLimit = Math.ceil(res.node.projectV2.items.totalCount / 100);

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

    return projectV2ItemEdges;
  }

  let edges = await fetchCardInfo(issueNodeId, projectNumber, undefined);
  let item: ProjectV2ItemEdge | undefined;
  let itemPage = 0;
  while (item === undefined && itemPage <= itemPageLimit) {
    const _item = edges.find((ele: ProjectV2ItemEdge) => ele.content.nodeId === issueNodeId) as ProjectV2ItemEdge;
    edges = await fetchCardInfo(issueNodeId, projectNumber, edges.pop()?.cursor);
    item = _item;
    itemPage += 1;
  }

  if (item === undefined) {
    core.setFailed('カードがありません');
  }

  const card: ProjectV2CardInfo = {
    projectNodeId: projectV2.id,
    item: item!
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
    console.log(v);
    tmpDict[v.fieldName] = v;
    acc.push(fetchField(issueNodeId, projectNumber, v.fieldName));
    return acc;
  }, []);

  let output: ProjectCardField[] = [];
  await Promise.all(tasks)
    .then((res) => {    
      output = res.reduce((acc: ProjectCardField[], v: any): ProjectCardField[] => {
        if (v.node.projectV2.field !== undefined) {
          acc.push({nodeId: v.node.projectV2.field.id, valueToken: tmpDict[v.node.projectV2.field.name]});
        }
        return acc;
      }, []);
  });

  return output;
}

async function updateCustomField(cardField: ProjectCardField, projectId: string, cardNodeId: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const fieldId = cardField.nodeId;
    const value = parseFloat(cardField.valueToken.val);
    await octokit.graphql(
      `
      mutation($projectId:ID!, $cardNodeId: ID!, $fieldId: ID!, $value: Float!) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId
            itemId: $cardNodeId
            fieldId: $fieldId
            value: {
              number: $value    
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

async function main() {

  // step1: titleからfieldなどの情報をtokenizeする
  const tokens = tokenize(issueTitle);
  if (tokens.length === 0) {
    core.setFailed('更新する情報がありません');
  }

  // step2: ProjectV2の情報を取得
  const card = await getProjectCardInfo(issueId, projectNumber);
  const projectId = card!.projectNodeId;
  const cardNodeId = card!.item.nodeId;

  // step3: 更新情報を生成
  // NOTE: 現状fieldの更新しか実装してないので下記のような実装をしている。
  const projectCardFields = await createProjectCardFields(issueId, projectNumber, tokens as GithubFieldValueToken[]);

  // step4: 情報を更新
  const tasks = projectCardFields.reduce((acc: Promise<void>[], f: ProjectCardField): Promise<void>[] => {
    acc.push(updateCustomField(f, projectId!, cardNodeId!));
    return acc;
  }, []);

  await Promise.all(tasks)
    .then((res) => {
      console.log('done');
  });


  // exit
  core.setOutput('cardNodeId', card!.item.nodeId);
}

const ghToken = core.getInput('githubToken', {required: true});
const octokit = github.getOctokit(ghToken);
const issueId = core.getInput('issueId', {required: true});
const projectNumber = parseInt(core.getInput('projectNumber', {required: true}));
const issueTitle: string = core.getInput('issueTitle', {required: true});

main();