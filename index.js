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
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        let projectV2;
        let itemPageLimit = 1; // MEMO: 1pageはあるものとする。
        function fetchCardInfo(issueNodeId, projectNumber, cursor) {
            return __awaiter(this, void 0, void 0, function* () {
                // TODO: cardのデータどうとるのがいいかは今後検討。まずは動くものを作る。
                const res = yield octokit.graphql(`
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
      `, {
                    issueNodeId,
                    projectNumber,
                    cursor
                });
                projectV2 = res.node.projectV2;
                itemPageLimit = Math.ceil(res.node.projectV2.items.totalCount / 100);
                const projectV2ItemEdges = res.node.projectV2.items.edges.reduce((acc, v) => {
                    acc.push({
                        nodeId: v.node.id,
                        content: {
                            nodeId: v.node.content.id
                        },
                        cursor: v.cursor,
                    });
                    return acc;
                }, []);
                return projectV2ItemEdges;
            });
        }
        let edges = yield fetchCardInfo(issueNodeId, projectNumber, undefined);
        let item;
        let itemPage = 0;
        while (item === undefined && itemPage <= itemPageLimit) {
            const _item = edges.find((ele) => ele.content.nodeId === issueNodeId);
            edges = yield fetchCardInfo(issueNodeId, projectNumber, (_a = edges.pop()) === null || _a === void 0 ? void 0 : _a.cursor);
            item = _item;
            itemPage += 1;
        }
        if (item === undefined) {
            core.setFailed('カードがありません');
        }
        const card = {
            projectNodeId: projectV2.id,
            item: item
        };
        return card;
    });
}
function createProjectCardFields(issueNodeId, projectNumber, fieldValueTokens) {
    return __awaiter(this, void 0, void 0, function* () {
        function fetchField(issueNodeId, projectNumber, fieldName) {
            return __awaiter(this, void 0, void 0, function* () {
                // TODO: fieldのデータどうとるのがいいかは今後検討。まずは動くものを作る。
                return yield octokit.graphql(`
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
      `, {
                    issueNodeId,
                    projectNumber,
                    fieldName
                });
            });
        }
        let tmpDict = {};
        const tasks = fieldValueTokens.reduce((acc, v) => {
            console.log(v);
            tmpDict[v.fieldName] = v;
            acc.push(fetchField(issueNodeId, projectNumber, v.fieldName));
            return acc;
        }, []);
        let output = [];
        yield Promise.all(tasks)
            .then((res) => {
            output = res.reduce((acc, v) => {
                if (v.node.projectV2.field !== undefined) {
                    acc.push({ nodeId: v.node.projectV2.field.id, valueToken: tmpDict[v.node.projectV2.field.name] });
                }
                return acc;
            }, []);
        });
        return output;
    });
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
        const cardNodeId = card.item.nodeId;
        // step3: 更新情報を生成
        // NOTE: 現状fieldの更新しか実装してないので下記のような実装をしている。
        const projectCardFields = yield createProjectCardFields(issueId, projectNumber, tokens);
        // step4: 情報を更新
        const tasks = projectCardFields.reduce((acc, f) => {
            acc.push(updateCustomField(f, projectId, cardNodeId));
            return acc;
        }, []);
        yield Promise.all(tasks)
            .then((res) => {
            console.log('done');
        });
        // exit
        core.setOutput('cardNodeId', card.item.nodeId);
    });
}
const ghToken = core.getInput('githubToken', { required: true });
const octokit = github.getOctokit(ghToken);
const issueId = core.getInput('issueId', { required: true });
const projectNumber = parseInt(core.getInput('projectNumber', { required: true }));
const issueTitle = core.getInput('issueTitle', { required: true });
main();
