/**
 * Azure DevOps API type definitions
 * No explicit `any` types — satisfies Requirement 17.2
 */

// ---------------------------------------------------------------------------
// Shared / primitive helpers
// ---------------------------------------------------------------------------

export interface IdentityRef {
  id: string;
  displayName: string;
  uniqueName: string;
  descriptor: string;
  url: string;
}

export interface ApiListResponse<T> {
  count: number;
  value: T[];
}

// ---------------------------------------------------------------------------
// Work Items
// ---------------------------------------------------------------------------

export interface WorkItemFields {
  "System.Id": number;
  "System.Title": string;
  "System.WorkItemType": string;
  "System.State": string;
  "System.AssignedTo"?: IdentityRef | string;
  "System.CreatedDate": string;
  "System.ChangedDate": string;
  "System.Description"?: string;
  "System.Tags"?: string;
  "System.AreaPath": string;
  "System.IterationPath": string;
  "System.TeamProject": string;
  "System.Rev"?: number;
  "System.CreatedBy"?: IdentityRef | string;
  "System.ChangedBy"?: IdentityRef | string;
  "System.CommentCount"?: number;
  "Microsoft.VSTS.Common.Priority"?: number;
  "Microsoft.VSTS.Scheduling.StoryPoints"?: number;
  "Microsoft.VSTS.Scheduling.Effort"?: number;
  "Microsoft.VSTS.Scheduling.RemainingWork"?: number;
  "Microsoft.VSTS.Scheduling.OriginalEstimate"?: number;
  "Microsoft.VSTS.Scheduling.CompletedWork"?: number;
  "Microsoft.VSTS.Common.AcceptanceCriteria"?: string;
  "Microsoft.VSTS.Common.ResolvedDate"?: string;
  "Microsoft.VSTS.Common.ClosedDate"?: string;
  "Microsoft.VSTS.Common.ActivatedDate"?: string;
  "Microsoft.VSTS.Common.Severity"?: string;
  "Microsoft.VSTS.Common.ValueArea"?: string;
  "Microsoft.VSTS.Common.BusinessValue"?: number;
  "Microsoft.VSTS.Common.TimeCriticality"?: number;
  "Microsoft.VSTS.Common.Risk"?: string;
  "Microsoft.VSTS.Build.IntegrationBuild"?: string;
  "Microsoft.VSTS.TCM.ReproSteps"?: string;
  "Microsoft.VSTS.TCM.SystemInfo"?: string;
  [key: string]: unknown;
}

export interface WorkItemRelationAttributes {
  isLocked?: boolean;
  name?: string;
  comment?: string;
  [key: string]: unknown;
}

export interface WorkItemRelation {
  rel: string;
  url: string;
  attributes: WorkItemRelationAttributes;
}

export interface WorkItem {
  id: number;
  rev: number;
  fields: WorkItemFields;
  url: string;
  relations?: WorkItemRelation[];
}

export interface WorkItemRevision {
  id: number;
  rev: number;
  fields: WorkItemFields;
  url: string;
}

export interface WorkItemComment {
  id: number;
  text: string;
  createdBy: IdentityRef;
  createdDate: string;
  modifiedDate?: string;
  modifiedBy?: IdentityRef;
  url?: string;
}

export interface WorkItemReference {
  id: number;
  url: string;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectCapabilities {
  versioncontrol?: { sourceControlType: string };
  processTemplate?: { templateName: string; templateTypeId: string };
  [key: string]: unknown;
}

export interface TeamReference {
  id: string;
  name: string;
  url: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  state: string;
  visibility: string;
  capabilities?: ProjectCapabilities;
  defaultTeam?: TeamReference;
  url?: string;
  lastUpdateTime?: string;
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export interface Team {
  id: string;
  name: string;
  description?: string;
  identityUrl?: string;
  projectId?: string;
  projectName?: string;
  url?: string;
}

export interface TeamMember {
  id: string;
  displayName: string;
  uniqueName: string;
  descriptor: string;
  isTeamAdmin?: boolean;
  identity?: IdentityRef;
}

// ---------------------------------------------------------------------------
// Sprints / Iterations
// ---------------------------------------------------------------------------

export interface SprintAttributes {
  startDate?: string;
  finishDate?: string;
  timeFrame?: "past" | "current" | "future";
}

export interface Sprint {
  id: string;
  name: string;
  path: string;
  attributes: SprintAttributes;
  url?: string;
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export interface BoardColumnStateMappings {
  [workItemType: string]: string;
}

export interface BoardColumn {
  id: string;
  name: string;
  stateMappings: BoardColumnStateMappings;
  isSplit: boolean;
  itemLimit: number;
  columnType?: string;
}

export interface Board {
  id: string;
  name: string;
  boardType?: string;
  url?: string;
  columns?: BoardColumn[];
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

export interface PipelineConfiguration {
  type: string;
  path?: string;
  repository?: PipelineRepository;
}

export interface PipelineRepository {
  id: string;
  type: string;
  name?: string;
  defaultBranch?: string;
}

export interface Pipeline {
  id: number;
  name: string;
  folder: string;
  revision: number;
  configuration?: PipelineConfiguration;
  url?: string;
}

export interface PipelineRunResources {
  repositories?: Record<string, PipelineRunRepository>;
  [key: string]: unknown;
}

export interface PipelineRunRepository {
  repository: PipelineRepository;
  refName?: string;
  version?: string;
}

export interface PipelineRun {
  id: number;
  name: string;
  state: string;
  result?: string;
  createdDate: string;
  finishedDate?: string;
  pipeline: Pipeline;
  resources?: PipelineRunResources;
  url?: string;
}

export interface PipelineStep {
  id: string;
  name: string;
  type?: string;
  state?: string;
  result?: string;
  startTime?: string;
  finishTime?: string;
  logUrl?: string;
}

export interface PipelineJob {
  id: string;
  name: string;
  type?: string;
  state?: string;
  result?: string;
  startTime?: string;
  finishTime?: string;
  steps?: PipelineStep[];
}

export interface PipelineStage {
  id: string;
  name: string;
  state?: string;
  result?: string;
  startTime?: string;
  finishTime?: string;
  jobs?: PipelineJob[];
}

// ---------------------------------------------------------------------------
// Repositories & Git
// ---------------------------------------------------------------------------

export interface Repository {
  id: string;
  name: string;
  defaultBranch?: string;
  remoteUrl?: string;
  sshUrl?: string;
  size?: number;
  project?: Project;
  url?: string;
}

export interface CommitAuthor {
  name: string;
  email: string;
  date: string;
}

export interface Commit {
  commitId: string;
  author: CommitAuthor;
  committer: CommitAuthor;
  comment: string;
  url?: string;
  remoteUrl?: string;
}

// ---------------------------------------------------------------------------
// Pull Requests
// ---------------------------------------------------------------------------

export interface PullRequestReviewer {
  id: string;
  displayName: string;
  uniqueName: string;
  vote: number;
  isRequired?: boolean;
  url?: string;
}

export interface PullRequest {
  pullRequestId: number;
  title: string;
  description?: string;
  status: string;
  createdBy: IdentityRef;
  creationDate: string;
  closedDate?: string;
  sourceRefName: string;
  targetRefName: string;
  reviewers: PullRequestReviewer[];
  mergeStatus?: string;
  workItemRefs?: WorkItemReference[];
  url?: string;
  repository?: Repository;
  isDraft?: boolean;
  mergeId?: string;
  lastMergeSourceCommit?: Commit;
  lastMergeTargetCommit?: Commit;
}

// ---------------------------------------------------------------------------
// WIQL / Saved Queries
// ---------------------------------------------------------------------------

export interface SavedQuery {
  id: string;
  name: string;
  path: string;
  queryType: string;
  wiql?: string;
  isPublic?: boolean;
  url?: string;
}

export interface WiqlQueryResult {
  queryType: string;
  queryResultType: string;
  asOf: string;
  columns: WiqlColumn[];
  workItems: WorkItemReference[];
}

export interface WiqlColumn {
  referenceName: string;
  name: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Test Plans
// ---------------------------------------------------------------------------

export interface TestPlan {
  id: number;
  name: string;
  description?: string;
  state: string;
  iteration?: string;
  areaPath?: string;
  startDate?: string;
  endDate?: string;
  owner?: IdentityRef;
  rootSuite?: TestSuiteReference;
  url?: string;
  project?: { id: string; name: string };
}

export interface TestSuiteReference {
  id: number;
  name: string;
  url?: string;
}

export interface TestSuite {
  id: number;
  name: string;
  suiteType: string;
  parentSuite?: TestSuiteReference;
  plan?: { id: number; name: string };
  queryString?: string;
  defaultConfigurations?: TestConfiguration[];
  children?: TestSuiteReference[];
  url?: string;
}

export interface TestConfiguration {
  id: number;
  name: string;
}

export interface TestCase {
  workItem: {
    id: number;
    name: string;
    url?: string;
  };
  pointAssignments: TestPointAssignment[];
}

export interface TestPointAssignment {
  id: number;
  configurationId: number;
  configurationName: string;
  tester?: IdentityRef;
}

export interface TestPoint {
  id: number;
  testCaseReference: { id: number; name: string };
  configuration: { id: string; name: string };
  outcome?: string;
  state: string;
  lastResultDetails?: { dateCompleted?: string; duration?: number };
  tester?: IdentityRef;
  assignedTo?: IdentityRef;
  url?: string;
}

export interface TestRun {
  id: number;
  name: string;
  state: string;
  plan?: { id: string; name: string };
  startedDate?: string;
  completedDate?: string;
  totalTests: number;
  passedTests: number;
  incompleteTests?: number;
  unanalyzedTests?: number;
  notApplicableTests?: number;
  url?: string;
  webAccessUrl?: string;
  owner?: IdentityRef;
  buildConfiguration?: { id: number; number: string; flavor: string; platform: string };
}

export interface TestResult {
  id: number;
  testCaseTitle: string;
  outcome: string;
  state: string;
  startedDate?: string;
  completedDate?: string;
  durationInMs?: number;
  errorMessage?: string;
  stackTrace?: string;
  comment?: string;
  testCase?: { id: string; name: string };
  testRun?: { id: string; name: string };
  configuration?: { id: string; name: string };
  owner?: IdentityRef;
  runBy?: IdentityRef;
  url?: string;
}
