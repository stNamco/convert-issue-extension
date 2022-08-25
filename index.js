"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const TokenKind = {
    LABEL: 1,
    CARD_FIELD: 2,
};
class GithubFieldValueToken {
    constructor(kind, name, val) {
        this.kind = kind;
        this.fieldName = name;
        this.val = val;
    }
    ;
}
// Labelのtokenizeも検討しているが後回し。むしろいらないかも。
function tokenize(input) {
    const result = input.match(/\(.+?:.+?\)/giu);
    const tokens = [];
    // MEMO: 現状fieldのみ実装
    for (var v of result !== null && result !== void 0 ? result : []) {
        let d = v.slice(1).slice(0, -1).split(':');
        tokens.push(new GithubFieldValueToken(TokenKind.CARD_FIELD, d[0], d[1]));
    }
    return tokens;
}
function getProjectCardInfo(issueNodeId, projectNumber) {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield octokit.graphql(`
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
    `, {
            issueNodeId,
            projectNumber
        });
        const projectV2 = res.node.projectV2;
        // NOTE: project number指定しているのでprojectは1つしか返ってこないはず。
        const projectV2Card = projectV2.items.edges[0].node;
        const fields = projectV2Card.fieldValues.nodes.reduce((acc, v) => {
            if (!!Object.keys(v).length) {
                const f = {
                    nodeId: v.field.id,
                    name: v.field.name
                };
                acc.push(f);
            }
            return acc;
        }, []);
        const card = {
            projectNodeId: projectV2.id,
            nodeId: projectV2Card.id,
            fields: fields,
        };
        return card;
    });
}
function createProjectCardFields(card, fieldValueTokens) {
    return fieldValueTokens.reduce((acc, v) => {
        const detectedFieldNode = card.fields.find(ele => ele.name === v.fieldName);
        if (detectedFieldNode !== undefined) {
            const f = {
                nodeId: detectedFieldNode.nodeId,
                valueToken: v
            };
            acc.push(f);
        }
        return acc;
    }, []);
}
function updateCustomField(cardField, projectId, cardNodeId) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            const fieldId = cardField.nodeId;
            const value = parseFloat(cardField.valueToken.val);
            yield octokit.graphql(`
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
      `, {
                projectId,
                cardNodeId,
                fieldId,
                value
            });
            resolve();
        }));
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        // step1: titleからfieldなどの情報をtokenizeする
        const tokens = tokenize(issueTitle);
        if (tokens.length === 0) {
            core.setFailed('更新する情報がありません');
        }
        // step2: ProjectV2の情報を取得
        const card = yield getProjectCardInfo(issueId, projectNumber);
        const projectId = card.projectNodeId;
        const cardNodeId = card.nodeId;
        // step3: 更新情報を生成
        // NOTE: 現状fieldの更新しか実装してないので下記のような実装をしている。
        const projectCardFields = createProjectCardFields(card, tokens);
        // step4: 情報を更新
        const tasks = projectCardFields.reduce((acc, f) => {
            acc.push(updateCustomField(f, projectId, cardNodeId));
            return acc;
        }, []);
        Promise.all(tasks)
            .then((res) => {
            console.log('done');
        });
        // exit
        core.setOutput('cardNodeId', card.nodeId);
    });
}
const ghToken = core.getInput('githubToken', { required: true });
const octokit = github.getOctokit(ghToken);
const issueId = core.getInput('issueId', { required: true });
const projectNumber = parseInt(core.getInput('projectNumber', { required: true }));
const issueTitle = core.getInput('issueTitle', { required: true });
main();
