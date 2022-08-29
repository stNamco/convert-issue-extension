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
const AppConstant = {
    TRACKED_IN_ISSUE_TITLE_FILED_NAME: "tracked in issue title",
};
class GithubFieldValueToken {
    constructor(name, val) {
        this.fieldName = name;
        this.val = val;
    }
    ;
}
class GithubLabelValueToken {
    constructor(name) {
        this.labelName = name;
    }
    ;
}
// Labelのtokenizeも検討しているが後回し。むしろいらないかも。
function tokenize(input) {
    function tokenizeField(input) {
        const tokens = [];
        const result = input.match(/\(.+?:.+?\)/giu);
        for (var v of result !== null && result !== void 0 ? result : []) {
            let d = v.slice(1).slice(0, -1).split(':');
            tokens.push(new GithubFieldValueToken(d[0], d[1]));
        }
        return tokens;
    }
    function tokenizeLabel(input) {
        const tokens = [];
        const result = input.match(/\[.+?\]/giu);
        for (var v of result !== null && result !== void 0 ? result : []) {
            tokens.push(new GithubLabelValueToken(v.slice(1).slice(0, -1)));
        }
        return tokens;
    }
    return {
        fieldTokens: tokenizeField(input),
        labelTokens: tokenizeLabel(input)
    };
}
const ProjectV2FieldDataType = {
    TEXT: 'TEXT',
    NUMBER: 'NUMBER'
};
function addIssueToProject(projectNumber, contentId) {
    return __awaiter(this, void 0, void 0, function* () {
        function getProjectInfo(projectNumber) {
            return __awaiter(this, void 0, void 0, function* () {
                const repositoryOwnerName = github.context.payload.repository.owner.login;
                const ownerType = github.context.payload.repository.owner.type.toLowerCase();
                const res = yield octokit.graphql(`query getProject($repositoryOwnerName: String!, $projectNumber: Int!) {
        ${ownerType}(login: $repositoryOwnerName) {
          projectV2(number: $projectNumber) {
            id
          }
        }
      }`, {
                    repositoryOwnerName,
                    projectNumber
                });
                return res[ownerType].projectV2.id;
            });
        }
        const projectId = yield getProjectInfo(projectNumber);
        const res = yield octokit.graphql(`mutation addIssueToProject($input: AddProjectV2ItemByIdInput!) {
      addProjectV2ItemById(input: $input) {
        item {
          id
        }
      }
    }`, {
            input: {
                projectId,
                contentId
            }
        });
        return projectId;
    });
}
function getProjectCardInfo(issueNodeId, projectNumber, shouldSyncWithTrackedInIssue) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        let trackedInIssue = undefined;
        let labels = undefined;
        function fetchCardInfo(issueNodeId, projectNumber, cursor, withTrackedInIssue = false, withLabel = false) {
            var _a, _b, _c, _d, _e, _f;
            return __awaiter(this, void 0, void 0, function* () {
                // TODO: cardのデータどうとるのがいいかは今後検討。まずは動くものを作る。
                const res = yield octokit.graphql(`
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
      `, {
                    issueNodeId,
                    projectNumber,
                    withTrackedInIssue,
                    cursor,
                    withLabel
                });
                if (!res.node.projectV2) {
                    return undefined;
                }
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
                if (withTrackedInIssue && ((_b = (_a = res === null || res === void 0 ? void 0 : res.node) === null || _a === void 0 ? void 0 : _a.trackedInIssues) === null || _b === void 0 ? void 0 : _b.edges.length) > 0 && !trackedInIssue) {
                    // NOTE: 一旦TrackedInIssuesは1つとして実装する。
                    const edge = (_d = (_c = res === null || res === void 0 ? void 0 : res.node) === null || _c === void 0 ? void 0 : _c.trackedInIssues) === null || _d === void 0 ? void 0 : _d.edges[0];
                    trackedInIssue = {
                        title: edge.node.title,
                        issueNumber: edge.node.number,
                        milestoneNumber: edge.node.milestone ? edge.node.milestone.number : undefined,
                    };
                }
                if (withTrackedInIssue && ((_f = (_e = res === null || res === void 0 ? void 0 : res.node) === null || _e === void 0 ? void 0 : _e.labels) === null || _f === void 0 ? void 0 : _f.nodes.length) > 0 && !labels) {
                    labels = res.node.labels.nodes.reduce((acc, v) => {
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
                };
            });
        }
        let info = yield fetchCardInfo(issueNodeId, projectNumber, undefined, shouldSyncWithTrackedInIssue, true);
        let projectV2NodeId;
        if (info === undefined) {
            if (shouldAddProjectIfNeeded) {
                projectV2NodeId = yield addIssueToProject(projectNumber, issueNodeId);
                info = yield fetchCardInfo(issueNodeId, projectNumber, undefined, shouldSyncWithTrackedInIssue);
            }
            else {
                core.setFailed("there is no project which is related to this issue");
            }
        }
        else {
            projectV2NodeId = info.projectV2NodeId;
        }
        let item = info.items.find((ele) => ele.content.nodeId === issueNodeId);
        let itemPage = 0;
        while (item === undefined && itemPage <= info.itemPageLimit) {
            const _item = info.items.find((ele) => ele.content.nodeId === issueNodeId);
            info = yield fetchCardInfo(issueNodeId, projectNumber, (_a = info.items.pop()) === null || _a === void 0 ? void 0 : _a.cursor);
            item = _item;
            itemPage += 1;
        }
        if (item === undefined) {
            core.setFailed('there is no card which is related to this issue');
        }
        const card = {
            projectNodeId: projectV2NodeId,
            item: item,
            trackedInIssue: info.trackedInIssue,
            labels: info.labels
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
                    dataType
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
            tmpDict[v.fieldName] = v;
            acc.push(fetchField(issueNodeId, projectNumber, v.fieldName));
            return acc;
        }, []);
        let output = [];
        yield Promise.all(tasks)
            .then((res) => {
            output = res.reduce((acc, v) => {
                if (v.node.projectV2.field !== undefined) {
                    const f = v.node.projectV2.field;
                    acc.push({ nodeId: f.id, valueToken: tmpDict[f.name], type: f.dataType });
                }
                return acc;
            }, []);
        });
        return output;
    });
}
// https://docs.github.com/ja/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects#updating-a-custom-text-number-or-date-field
// NOTE: supported field data type are STRING and NUMBER for now.
function updateCustomField(cardField, projectId, cardNodeId) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            const fieldId = cardField.nodeId;
            const value = cardField.type == ProjectV2FieldDataType.NUMBER ? parseFloat(cardField.valueToken.val) : cardField.valueToken.val;
            const valueDataType = cardField.type.toLowerCase();
            const valueQueryType = cardField.type == ProjectV2FieldDataType.NUMBER ? "Float!" : "String!";
            yield octokit.graphql(`
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
// https://docs.github.com/ja/rest/issues/issues#update-an-issue
function updateIssue(input) {
    var _a, _b, _c;
    return __awaiter(this, void 0, void 0, function* () {
        const repositoryOwnerName = (_a = github.context.payload.repository) === null || _a === void 0 ? void 0 : _a.owner.login;
        const issueRepository = (_b = github.context.payload.repository) === null || _b === void 0 ? void 0 : _b.name;
        const issueNumber = (_c = github.context.payload.issue) === null || _c === void 0 ? void 0 : _c.number;
        yield octokit.request(`PATCH /repos/${repositoryOwnerName}/${issueRepository}/issues/${issueNumber}`, {
            milestone: input.milestoneNumber,
            labels: input.labels
        });
    });
}
function main() {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        // step1: titleからfieldなどの情報をtokenizeする
        const tokens = tokenize(issueTitle);
        // step2: ProjectV2の情報を取得
        const card = yield getProjectCardInfo(issueId, projectNumber, shouldSyncWithTrackedInIssue);
        const projectId = card.projectNodeId;
        const cardNodeId = card.item.nodeId;
        // step3: 情報を更新
        // step3-1: fieldを更新
        let fieldTokens = Array.from(tokens.fieldTokens);
        // NOTE: shouldSyncWithTrackedInIssueがtrueの場合、更新するfieldを追加する
        if (shouldSyncWithTrackedInIssue && (card === null || card === void 0 ? void 0 : card.trackedInIssue) !== undefined) {
            fieldTokens.push({
                fieldName: AppConstant.TRACKED_IN_ISSUE_TITLE_FILED_NAME,
                val: `#${card.trackedInIssue.issueNumber} ${card.trackedInIssue.title}`
            });
        }
        if (fieldTokens.length > 0) {
            // NOTE: 現状fieldの更新しか実装してないので下記のような実装をしている。
            const projectCardFields = yield createProjectCardFields(issueId, projectNumber, fieldTokens);
            const tasks = projectCardFields.reduce((acc, f) => {
                acc.push(updateCustomField(f, projectId, cardNodeId));
                return acc;
            }, []);
            yield Promise.all(tasks);
        }
        // step3-2: issueを更新    
        const tokenLabels = tokens.labelTokens.reduce((acc, v) => {
            acc.push(v.labelName);
            return acc;
        }, []);
        const labelSet = new Set(tokenLabels.concat((_a = card.labels) !== null && _a !== void 0 ? _a : []));
        const labels = [...labelSet];
        yield updateIssue({
            milestoneNumber: (_b = card === null || card === void 0 ? void 0 : card.trackedInIssue) === null || _b === void 0 ? void 0 : _b.milestoneNumber,
            labels: labels.length > 0 ? labels : undefined
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
const shouldSyncWithTrackedInIssue = core.getInput('shouldSyncWithTrackedInIssue', { required: false }) === "true";
const shouldAddProjectIfNeeded = core.getInput('shouldAddProjectIfNeeded', { required: false }) === "true";
main();
