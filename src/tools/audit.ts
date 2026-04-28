import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { azureClient } from "../azureClient.js";
import { config } from "../config.js";
import type {
  ApiListResponse,
  IdentityRef,
  Pipeline,
  PipelineRun,
  PullRequest,
  Sprint,
  WiqlQueryResult,
  WorkItem,
  WorkItemRevision,
} from "../types/azure.js";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface SprintWorkItemsResponse {
  workItemRelations: Array<{
    rel: string | null;
    target: { id: number; url: string };
  }>;
}

interface AuditLogEntry {
  workItemId: number;
  rev: number;
  changedBy: string;
  changedDate: string;
  changes: Array<{ field: string; oldValue: unknown; newValue: unknown }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorResponse(err: unknown): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  const error = err as Error & { statusCode?: number };
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: error.message, statusCode: error.statusCode ?? 500 }),
      },
    ],
    isError: true,
  };
}

function resolveIdentity(value: IdentityRef | string | undefined): string {
  if (!value) return "Unassigned";
  if (typeof value === "string") return value || "Unassigned";
  return value.displayName || value.uniqueName || "Unassigned";
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function daysBetween(start: string | Date, end: string | Date): number {
  return Math.max(
    0,
    (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)
  );
}

async function runWiql(project: string, wiql: string): Promise<number[]> {
  const response = await azureClient.post<WiqlQueryResult>(
    `/${encodeURIComponent(project)}/_apis/wit/wiql`,
    { query: wiql }
  );
  return (response.data.workItems ?? []).map((ref) => ref.id);
}

async function fetchWorkItemDetails(
  ids: number[],
  fields: string
): Promise<WorkItem[]> {
  if (ids.length === 0) return [];
  const BATCH = 200;
  const results: WorkItem[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const response = await azureClient.get<ApiListResponse<WorkItem>>(
      `/_apis/wit/workitems`,
      { params: { ids: batch.join(","), fields } }
    );
    results.push(...(response.data.value ?? []));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // get_blocked_items_alert — Requirement 16.1
  // -------------------------------------------------------------------------
  server.tool(
    "get_blocked_items_alert",
    "Returns all work items with state 'Blocked' or tag 'impedimento' that have been in that state for more than BLOCKED_ITEM_DAYS days. Includes assignee and last-updated timestamp.",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name"),
    },
    async ({ project }) => {
      try {
        const cutoff = daysAgo(config.BLOCKED_ITEM_DAYS);
        const cutoffISO = cutoff.toISOString();

        const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND ([System.State] = 'Blocked' OR [System.Tags] CONTAINS 'impedimento') AND [System.ChangedDate] <= '${cutoffISO}'`;

        const ids = await runWiql(project, wiql);
        const items = await fetchWorkItemDetails(
          ids,
          "System.Id,System.Title,System.AssignedTo,System.State,System.ChangedDate"
        );

        const now = new Date();
        const result = items.map((wi) => {
          const changedDate = wi.fields["System.ChangedDate"];
          const daysBlocked = Math.floor(daysBetween(changedDate, now));
          return {
            id: wi.id,
            title: wi.fields["System.Title"],
            assignee: resolveIdentity(wi.fields["System.AssignedTo"]),
            state: wi.fields["System.State"],
            lastUpdated: changedDate,
            daysBlocked,
          };
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ items: result }) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // get_sprint_health_alert — Requirement 16.2
  // -------------------------------------------------------------------------
  server.tool(
    "get_sprint_health_alert",
    "Calculates the percentage of work completed vs percentage of sprint days elapsed and returns a risk level (low/medium/high) with a textual recommendation.",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name"),
      iterationId: z.string().describe("Sprint iteration ID (GUID)"),
    },
    async ({ project, team, iterationId }) => {
      try {
        const sprintResponse = await azureClient.get<Sprint>(
          `/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations/${iterationId}`
        );

        const sprint = sprintResponse.data;
        const startDate = sprint.attributes?.startDate;
        const finishDate = sprint.attributes?.finishDate;

        if (!startDate || !finishDate) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "Sprint does not have start/finish dates configured" }),
              },
            ],
            isError: true,
          };
        }

        const sprintItemsResponse = await azureClient.get<SprintWorkItemsResponse>(
          `/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations/${iterationId}/workitems`
        );

        const relations = sprintItemsResponse.data.workItemRelations ?? [];
        const itemIds = relations.filter((r) => r.rel === null).map((r) => r.target.id);

        let totalItems = itemIds.length;
        let completedItems = 0;

        if (itemIds.length > 0) {
          const items = await fetchWorkItemDetails(
            itemIds,
            "System.Id,System.State"
          );
          totalItems = items.length;
          completedItems = items.filter((wi) => {
            const state = wi.fields["System.State"];
            return state === "Done" || state === "Closed" || state === "Resolved";
          }).length;
        }

        const now = new Date();
        const start = new Date(startDate);
        const finish = new Date(finishDate);

        const totalMs = finish.getTime() - start.getTime();
        const elapsedMs = now.getTime() - start.getTime();

        const percentElapsed =
          totalMs > 0 ? Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100)) : 0;
        const percentComplete =
          totalItems > 0 ? (completedItems / totalItems) * 100 : 0;

        let riskLevel: "low" | "medium" | "high";
        let recommendation: string;

        if (percentComplete >= percentElapsed - 10) {
          riskLevel = "low";
          recommendation =
            "Sprint is on track. Keep the current pace to finish on time.";
        } else if (percentComplete >= percentElapsed - 25) {
          riskLevel = "medium";
          recommendation =
            "Sprint is slightly behind. Consider removing scope or addressing blockers to recover.";
        } else {
          riskLevel = "high";
          recommendation =
            "Sprint is significantly behind. Immediate action required: remove scope, escalate blockers, or plan a carry-over.";
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                percentComplete: Math.round(percentComplete * 100) / 100,
                percentElapsed: Math.round(percentElapsed * 100) / 100,
                riskLevel,
                recommendation,
              }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // get_stale_prs_alert — Requirement 16.3
  // -------------------------------------------------------------------------
  server.tool(
    "get_stale_prs_alert",
    "Returns all open pull requests without activity for more than STALE_PR_DAYS days. Includes author, pending reviewers and last activity timestamp.",
    {
      project: z.string().describe("Project name or ID"),
      repositoryId: z.string().describe("Git repository ID"),
    },
    async ({ project, repositoryId }) => {
      try {
        const prResponse = await azureClient.get<ApiListResponse<PullRequest>>(
          `/${encodeURIComponent(project)}/_apis/git/repositories/${repositoryId}/pullrequests`,
          { params: { "searchCriteria.status": "active" } }
        );

        const staleCutoff = daysAgo(config.STALE_PR_DAYS);
        const prs = (prResponse.data.value ?? []).filter((pr) => {
          const lastActivity = pr.closedDate ?? pr.creationDate;
          return new Date(lastActivity) < staleCutoff;
        });

        const result = prs.map((pr) => ({
          pullRequestId: pr.pullRequestId,
          title: pr.title,
          author: resolveIdentity(pr.createdBy),
          pendingReviewers: (pr.reviewers ?? [])
            .filter((r) => r.vote === 0)
            .map((r) => r.displayName),
          lastActivity: pr.closedDate ?? pr.creationDate,
        }));

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ prs: result }) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // get_failing_pipelines_alert — Requirement 16.4
  // -------------------------------------------------------------------------
  server.tool(
    "get_failing_pipelines_alert",
    "Returns all pipelines that have had FAILING_PIPELINE_THRESHOLD or more consecutive failed runs. Includes pipeline name, last run time and consecutive failure count.",
    {
      project: z.string().describe("Project name or ID"),
    },
    async ({ project }) => {
      try {
        const pipelinesResponse = await azureClient.get<ApiListResponse<Pipeline>>(
          `/${encodeURIComponent(project)}/_apis/pipelines`
        );

        const pipelines = pipelinesResponse.data.value ?? [];

        const results = await Promise.all(
          pipelines.map(async (pipeline) => {
            try {
              const runsResponse = await azureClient.get<ApiListResponse<PipelineRun>>(
                `/${encodeURIComponent(project)}/_apis/pipelines/${pipeline.id}/runs`
              );

              const runs = (runsResponse.data.value ?? []).sort(
                (a, b) =>
                  new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime()
              );

              let consecutiveFailures = 0;
              for (const run of runs) {
                if (run.result === "failed" || run.result === "canceled") {
                  consecutiveFailures += 1;
                } else {
                  break;
                }
              }

              return {
                id: pipeline.id,
                name: pipeline.name,
                consecutiveFailures,
                lastRunTime: runs[0]?.createdDate ?? null,
              };
            } catch {
              return null;
            }
          })
        );

        const failing = results.filter(
          (r): r is NonNullable<typeof r> =>
            r !== null && r.consecutiveFailures >= config.FAILING_PIPELINE_THRESHOLD
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ pipelines: failing }) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // get_audit_log — Requirement 16.5
  // -------------------------------------------------------------------------
  server.tool(
    "get_audit_log",
    "Returns a chronological log of field changes per work item. Accepts a list of work item IDs or a date range. Each entry includes field name, old value, new value, changed-by and timestamp.",
    {
      project: z.string().describe("Project name or ID"),
      ids: z.array(z.number()).optional().describe("List of work item IDs to audit"),
      startDate: z.string().optional().describe("Start date (ISO 8601) for date-range query"),
      endDate: z.string().optional().describe("End date (ISO 8601) for date-range query"),
    },
    async ({ project, ids, startDate, endDate }) => {
      try {
        let workItemIds: number[] = ids ?? [];

        if (workItemIds.length === 0 && startDate && endDate) {
          const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.ChangedDate] >= '${startDate}' AND [System.ChangedDate] <= '${endDate}'`;
          workItemIds = await runWiql(project, wiql);
        }

        if (workItemIds.length === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ log: [] }) }],
          };
        }

        const log: AuditLogEntry[] = [];

        await Promise.all(
          workItemIds.map(async (id) => {
            try {
              const revisionsResponse = await azureClient.get<
                ApiListResponse<WorkItemRevision>
              >(`/_apis/wit/workitems/${id}/revisions`, {
                params: { $expand: "all" },
              });

              const revisions = revisionsResponse.data.value ?? [];

              for (let i = 1; i < revisions.length; i++) {
                const prev = revisions[i - 1];
                const curr = revisions[i];

                const changes: AuditLogEntry["changes"] = [];

                for (const field of Object.keys(curr.fields)) {
                  const newVal = curr.fields[field];
                  const oldVal = prev.fields[field];
                  if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
                    changes.push({ field, oldValue: oldVal, newValue: newVal });
                  }
                }

                if (changes.length > 0) {
                  log.push({
                    workItemId: id,
                    rev: curr.rev,
                    changedBy: resolveIdentity(curr.fields["System.ChangedBy"]),
                    changedDate: curr.fields["System.ChangedDate"],
                    changes,
                  });
                }
              }
            } catch {
              // Skip items that fail to fetch revisions
            }
          })
        );

        log.sort(
          (a, b) =>
            new Date(a.changedDate).getTime() - new Date(b.changedDate).getTime()
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ log }) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // get_items_without_estimation — Requirement 16.6
  // -------------------------------------------------------------------------
  server.tool(
    "get_items_without_estimation",
    "Returns all work items that have no story points and no effort value set. Supports optional sprint and area path filters.",
    {
      project: z.string().describe("Project name or ID"),
      sprint: z.string().optional().describe("Sprint iteration path filter (optional)"),
      areaPath: z.string().optional().describe("Area path filter (optional)"),
    },
    async ({ project, sprint, areaPath }) => {
      try {
        let wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [Microsoft.VSTS.Scheduling.StoryPoints] = '' AND [Microsoft.VSTS.Scheduling.Effort] = ''`;

        if (sprint) {
          wiql += ` AND [System.IterationPath] = '${sprint}'`;
        }
        if (areaPath) {
          wiql += ` AND [System.AreaPath] UNDER '${areaPath}'`;
        }

        const ids = await runWiql(project, wiql);
        const items = await fetchWorkItemDetails(
          ids,
          "System.Id,System.Title,System.WorkItemType,System.AssignedTo"
        );

        const result = items.map((wi) => ({
          id: wi.id,
          title: wi.fields["System.Title"],
          type: wi.fields["System.WorkItemType"],
          assignee: resolveIdentity(wi.fields["System.AssignedTo"]),
        }));

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ items: result }) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // get_prs_without_required_review — Requirement 16.7
  // -------------------------------------------------------------------------
  server.tool(
    "get_prs_without_required_review",
    "Returns all completed pull requests that were merged without the required number of approvals (at least 1 reviewer with vote >= 10).",
    {
      project: z.string().describe("Project name or ID"),
      repositoryId: z.string().describe("Git repository ID"),
    },
    async ({ project, repositoryId }) => {
      try {
        const prResponse = await azureClient.get<ApiListResponse<PullRequest>>(
          `/${encodeURIComponent(project)}/_apis/git/repositories/${repositoryId}/pullrequests`,
          { params: { "searchCriteria.status": "completed" } }
        );

        const prs = prResponse.data.value ?? [];

        const result = prs
          .map((pr) => {
            const approvalCount = (pr.reviewers ?? []).filter((r) => r.vote >= 10).length;
            return {
              pullRequestId: pr.pullRequestId,
              title: pr.title,
              approvalCount,
              mergedBy: resolveIdentity(pr.createdBy),
            };
          })
          .filter((pr) => pr.approvalCount < 1);

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ prs: result }) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // get_items_without_acceptance_criteria — Requirement 16.8
  // -------------------------------------------------------------------------
  server.tool(
    "get_items_without_acceptance_criteria",
    "Returns all User Stories where the acceptance criteria field is empty or absent. Supports optional sprint and area path filters.",
    {
      project: z.string().describe("Project name or ID"),
      sprint: z.string().optional().describe("Sprint iteration path filter (optional)"),
      areaPath: z.string().optional().describe("Area path filter (optional)"),
    },
    async ({ project, sprint, areaPath }) => {
      try {
        let wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] = 'User Story' AND [Microsoft.VSTS.Common.AcceptanceCriteria] = ''`;

        if (sprint) {
          wiql += ` AND [System.IterationPath] = '${sprint}'`;
        }
        if (areaPath) {
          wiql += ` AND [System.AreaPath] UNDER '${areaPath}'`;
        }

        const ids = await runWiql(project, wiql);
        const items = await fetchWorkItemDetails(
          ids,
          "System.Id,System.Title,System.AssignedTo,System.State"
        );

        const result = items.map((wi) => ({
          id: wi.id,
          title: wi.fields["System.Title"],
          assignee: resolveIdentity(wi.fields["System.AssignedTo"]),
          state: wi.fields["System.State"],
        }));

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ items: result }) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );
}
