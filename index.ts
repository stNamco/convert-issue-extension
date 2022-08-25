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

interface ProjectV2CardInfo {
  projectNodeId: string;
  nodeId: string;
  fields: ProjectV2Field[];
}

interface ProjectV2Field {
  nodeId: string;
  name: string;
}

async function getProjectCardInfo(issueNodeId: string, projectNumber: number): Promise<ProjectV2CardInfo | undefined> {  
  const res: any = await octokit.graphql(
    `
    query getCardInfo($issueNodeId: ID!, $projectNumber: Int!) {
      node(id: $issueNodeId) {
       ... on Issue {
        id
        number
        title
            projectV2(number: $projectNumber) {
          id
          title
          items(first: 1) {
            edges {
              node {
                id
                content {
                  ... on Issue {
                    id
                    title
                  }
                }
                fieldValues(first: 10) {
                  nodes {
                    ... on ProjectV2ItemFieldNumberValue {
                      field {
                        ... on ProjectV2Field {
                          id
                          name
                        }
                      }
                    }
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
      projectNumber
    }
  )

  const projectV2 = res.node.projectV2;
  // NOTE: project number指定しているのでprojectは1つしか返ってこないはず。
  const projectV2Card = projectV2.items.edges[0].node;
  const fields = projectV2Card.fieldValues.nodes.reduce((acc: ProjectV2Field[], v: any): ProjectV2Field[] => {
    if (!!Object.keys(v).length) {
      const f: ProjectV2Field = {
        nodeId: v.field.id,
        name: v.field.name
      };
      acc.push(f);
    }
    return acc;
  }, []);

  const card: ProjectV2CardInfo = {
    projectNodeId: projectV2.id,
    nodeId: projectV2Card.id,
    fields: fields,
  };
  return card;
}

function createProjectCardFields(card: ProjectV2CardInfo, fieldValueTokens: GithubFieldValueToken[]): ProjectCardField[] {
  return fieldValueTokens.reduce((acc: ProjectCardField[], v: GithubFieldValueToken): ProjectCardField[] => {
    const detectedFieldNode = card.fields.find(ele => ele.name === v.fieldName);
    if (detectedFieldNode !== undefined) {
      const f: ProjectCardField = {
        nodeId: detectedFieldNode.nodeId,
        valueToken: v
      };
      acc.push(f);
    }
    return acc;
  }, []);
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
  const cardNodeId = card!.nodeId;


  // step3: 更新情報を生成
  // NOTE: 現状fieldの更新しか実装してないので下記のような実装をしている。
  const projectCardFields = createProjectCardFields(card!, tokens as GithubFieldValueToken[]);

  // step4: 情報を更新
  const tasks = projectCardFields.reduce((acc: Promise<void>[], f: ProjectCardField): Promise<void>[] => {
    acc.push(updateCustomField(f, projectId!, cardNodeId!));
    return acc;
  }, []);

  Promise.all(tasks)
    .then((res) => {
      console.log('done');
  });


  // exit
  core.setOutput('cardNodeId', card!.nodeId);
}

const ghToken = core.getInput('githubToken', {required: true});
const octokit = github.getOctokit(ghToken);
const issueId = core.getInput('issueId', {required: true});
const projectNumber = parseInt(core.getInput('projectNumber', {required: true}));
const issueTitle: string = core.getInput('issueTitle', {required: true});

main();