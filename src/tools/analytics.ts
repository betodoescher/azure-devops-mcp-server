import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { azureClient } from "../azureClient.js";
import { config } from "../config.js";
import type {
  ApiListResponse,
  PullRequest,
  Sprint,
  WiqlQueryResult,
  WorkItem,
  WorkItemRevision,
} from "../types/azure.js";

// ---------------------------------------------------------------------------
// Additional types for analytics
// ---------------------------------------------------------------------------

interface SprintWorkItemsResponse {
  workItemRelations: Array<{
    rel: string | null;
    target: { id: number; url: string };
  }>;
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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calcStats(values: number[]): {
  avg: number;
  median: number;
  min: number;
  max: number;
} {
  if (values.length === 0) {
    return { avg: 0, median: 0, min: 0, max: 0 };
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return {
    avg: Math.round((sum / values.length) * 100) / 100,
    median: Math.round(median(values) * 100) / 100,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function daysBetween(start: string | Date, end: string | Date): number {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  return Math.max(0, (endMs - startMs) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // get_cycle_time — Requirements 11.1, 11.8
  server.tool(
    "get_cycle_time",
    "Calculate cycle time (time from 'Active' to 'Done') for completed work items in a date range. Returns avg, median, min, max in days grouped by work item type.",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name"),
      startDate: z.string().describe("Start date in ISO 8601 format (e.g. 2024-01-01)"),
      endDate: z.string().describe("End date in ISO 8601 format (e.g. 2024-03-31)"),
    },
    async ({ project, startDate, endDate }) => {
      try {
        const wiql = `SELECT TOP 200 [System.Id],[System.WorkItemType] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.State] = 'Done' AND [Microsoft.VSTS.Common.ClosedDate] >= '${startDate}' AND [Microsoft.VSTS.Common.ClosedDate] <= '${endDate}'`;

        const wiqlResponse = await azureClient.post<WiqlQueryResult>(
          `/${encodeURIComponent(project)}/_apis/wit/wiql`,
          { query: wiql }
        );

        const workItemRefs = wiqlResponse.data.workItems ?? [];
        if (workItemRefs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ byType: {} }),
              },
            ],
          };
        }

        // Collect cycle times per work item type
        const byType: Record<string, number[]> = {};

        await Promise.all(
          workItemRefs.map(async (ref) => {
            try {
              const revisionsResponse = await azureClient.get<
                ApiListResponse<WorkItemRevision>
              >(
                `/_apis/wit/workitems/${ref.id}/revisions`,
                { params: { $expand: "all" } }
              );

              const revisions = revisionsResponse.data.value;

              // Find first revision where state became "Active"
              let activatedDate: string | undefined;
              let closedDate: string | undefined;

              for (const rev of revisions) {
                const state = rev.fields["System.State"];
                if (!activatedDate && state === "Active") {
                  activatedDate =
                    (rev.fields["Microsoft.VSTS.Common.ActivatedDate"] as string | undefined) ??
                    rev.fields["System.ChangedDate"];
                }
                if (state === "Done" || state === "Closed" || state === "Resolved") {
                  closedDate =
                    (rev.fields["Microsoft.VSTS.Common.ClosedDate"] as string | undefined) ??
                    rev.fields["System.ChangedDate"];
                }
              }

              if (!activatedDate || !closedDate) return;

              const cycleTimeDays = daysBetween(activatedDate, closedDate);
              const workItemType = revisions[revisions.length - 1]?.fields["System.WorkItemType"] ?? "Unknown";

              if (!byType[workItemType]) byType[workItemType] = [];
              byType[workItemType].push(cycleTimeDays);
            } catch {
              // Skip items that fail to fetch revisions
            }
          })
        );

        const result: Record<
          string,
          { avg: number; median: number; min: number; max: number; count: number }
        > = {};

        for (const [type, values] of Object.entries(byType)) {
          result[type] = { ...calcStats(values), count: values.length };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ byType: result }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // get_lead_time — Requirements 11.2, 11.8
  server.tool(
    "get_lead_time",
    "Calculate lead time (time from creation to 'Done') for completed work items in a date range. Returns avg, median, min, max in days grouped by work item type.",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name"),
      startDate: z.string().describe("Start date in ISO 8601 format (e.g. 2024-01-01)"),
      endDate: z.string().describe("End date in ISO 8601 format (e.g. 2024-03-31)"),
    },
    async ({ project, startDate, endDate }) => {
      try {
        const wiql = `SELECT TOP 200 [System.Id],[System.WorkItemType] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.State] = 'Done' AND [Microsoft.VSTS.Common.ClosedDate] >= '${startDate}' AND [Microsoft.VSTS.Common.ClosedDate] <= '${endDate}'`;

        const wiqlResponse = await azureClient.post<WiqlQueryResult>(
          `/${encodeURIComponent(project)}/_apis/wit/wiql`,
          { query: wiql }
        );

        const workItemRefs = wiqlResponse.data.workItems ?? [];
        if (workItemRefs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ byType: {} }),
              },
            ],
          };
        }

        const ids = workItemRefs.map((ref) => ref.id).join(",");
        const detailsResponse = await azureClient.get<ApiListResponse<WorkItem>>(
          `/_apis/wit/workitems`,
          {
            params: {
              ids,
              $expand: "all",
            },
          }
        );

        const byType: Record<string, number[]> = {};

        for (const wi of detailsResponse.data.value) {
          const createdDate = wi.fields["System.CreatedDate"];
          const closedDate = wi.fields["Microsoft.VSTS.Common.ClosedDate"];
          const workItemType = wi.fields["System.WorkItemType"];

          if (!createdDate || !closedDate) continue;

          const leadTimeDays = daysBetween(createdDate, closedDate);

          if (!byType[workItemType]) byType[workItemType] = [];
          byType[workItemType].push(leadTimeDays);
        }

        const result: Record<
          string,
          { avg: number; median: number; min: number; max: number; count: number }
        > = {};

        for (const [type, values] of Object.entries(byType)) {
          result[type] = { ...calcStats(values), count: values.length };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ byType: result }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // get_team_throughput — Requirements 11.3, 11.8
  // ---------------------------------------------------------------------------
  server.tool(
    "get_team_throughput",
    "Returns the number of completed work items per week within a date range, broken down by work item type. All aggregation is done server-side.",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name"),
      startDate: z.string().describe("Start date in ISO 8601 format (e.g. 2024-01-01)"),
      endDate: z.string().describe("End date in ISO 8601 format (e.g. 2024-03-31)"),
    },
    async ({ project, startDate, endDate }) => {
      try {
        const wiql = `SELECT TOP 500 [System.Id],[System.WorkItemType],[Microsoft.VSTS.Common.ClosedDate] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.State] = 'Done' AND [Microsoft.VSTS.Common.ClosedDate] >= '${startDate}' AND [Microsoft.VSTS.Common.ClosedDate] <= '${endDate}'`;

        const wiqlResponse = await azureClient.post<WiqlQueryResult>(
          `/${encodeURIComponent(project)}/_apis/wit/wiql`,
          { query: wiql }
        );

        const workItemRefs = wiqlResponse.data.workItems ?? [];
        if (workItemRefs.length === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ weeks: {} }) }],
          };
        }

        const ids = workItemRefs.map((r) => r.id).join(",");
        const detailsResponse = await azureClient.get<ApiListResponse<WorkItem>>(
          `/_apis/wit/workitems`,
          { params: { ids, fields: "System.WorkItemType,Microsoft.VSTS.Common.ClosedDate" } }
        );

        // Helper: get ISO week key "YYYY-Www"
        function isoWeekKey(dateStr: string): string {
          const d = new Date(dateStr);
          // ISO week: Thursday of the week determines the year
          const thursday = new Date(d);
          thursday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
          const year = thursday.getFullYear();
          const jan4 = new Date(year, 0, 4);
          const weekNum =
            1 +
            Math.round(
              ((thursday.getTime() - jan4.getTime()) / 86400000 -
                3 +
                ((jan4.getDay() + 6) % 7)) /
                7
            );
          return `${year}-W${String(weekNum).padStart(2, "0")}`;
        }

        const weeks: Record<
          string,
          { total: number; byType: Record<string, number> }
        > = {};

        for (const wi of detailsResponse.data.value) {
          const closedDate = wi.fields["Microsoft.VSTS.Common.ClosedDate"];
          const workItemType = wi.fields["System.WorkItemType"];
          if (!closedDate) continue;

          const weekKey = isoWeekKey(closedDate);
          if (!weeks[weekKey]) weeks[weekKey] = { total: 0, byType: {} };
          weeks[weekKey].total += 1;
          weeks[weekKey].byType[workItemType] =
            (weeks[weekKey].byType[workItemType] ?? 0) + 1;
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ weeks }) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // get_velocity_history — Requirements 11.4, 11.8
  // ---------------------------------------------------------------------------
  server.tool(
    "get_velocity_history",
    "Returns story points and item count completed per sprint for the last N sprints (default 6). All aggregation is done server-side.",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name"),
      sprintCount: z
        .number()
        .int()
        .positive()
        .default(6)
        .describe("Number of past sprints to include (default 6)"),
    },
    async ({ project, team, sprintCount }) => {
      try {
        // Fetch all iterations for the team
        const iterationsResponse = await azureClient.get<ApiListResponse<Sprint>>(
          `/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations`
        );

        const allSprints = iterationsResponse.data.value ?? [];
        const now = new Date();

        // Keep only past sprints (finishDate in the past), sort by finishDate desc
        const pastSprints = allSprints
          .filter((s) => {
            const finish = s.attributes?.finishDate;
            return finish !== undefined && new Date(finish) < now;
          })
          .sort((a, b) => {
            const aEnd = new Date(a.attributes?.finishDate ?? 0).getTime();
            const bEnd = new Date(b.attributes?.finishDate ?? 0).getTime();
            return bEnd - aEnd;
          })
          .slice(0, sprintCount);

        if (pastSprints.length === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ sprints: [] }) }],
          };
        }

        const sprintResults = await Promise.all(
          pastSprints.map(async (sprint) => {
            try {
              const iterationPath = sprint.path;
              const wiql = `SELECT TOP 500 [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.State] = 'Done' AND [System.IterationPath] = '${iterationPath}'`;

              const wiqlResponse = await azureClient.post<WiqlQueryResult>(
                `/${encodeURIComponent(project)}/_apis/wit/wiql`,
                { query: wiql }
              );

              const refs = wiqlResponse.data.workItems ?? [];
              let storyPoints = 0;

              if (refs.length > 0) {
                const ids = refs.map((r) => r.id).join(",");
                const detailsResponse = await azureClient.get<ApiListResponse<WorkItem>>(
                  `/_apis/wit/workitems`,
                  {
                    params: {
                      ids,
                      fields: "Microsoft.VSTS.Scheduling.StoryPoints",
                    },
                  }
                );
                for (const wi of detailsResponse.data.value) {
                  storyPoints += wi.fields["Microsoft.VSTS.Scheduling.StoryPoints"] ?? 0;
                }
              }

              return {
                name: sprint.name,
                startDate: sprint.attributes?.startDate ?? "",
                finishDate: sprint.attributes?.finishDate ?? "",
                storyPoints: Math.round(storyPoints * 100) / 100,
                itemCount: refs.length,
              };
            } catch {
              return {
                name: sprint.name,
                startDate: sprint.attributes?.startDate ?? "",
                finishDate: sprint.attributes?.finishDate ?? "",
                storyPoints: 0,
                itemCount: 0,
              };
            }
          })
        );

        // Return in chronological order (oldest first)
        const sprints = sprintResults.reverse();

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ sprints }) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // get_sprint_burndown — Requirements 11.5, 11.8
  // ---------------------------------------------------------------------------
  server.tool(
    "get_sprint_burndown",
    "Returns a tabular burndown dataset for a sprint with one row per day showing remaining work and ideal burndown. All calculations are done server-side.",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name"),
      iterationId: z.string().describe("Sprint iteration ID (GUID)"),
    },
    async ({ project, team, iterationId }) => {
      try {
        // Get sprint details
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
                text: JSON.stringify({
                  error: "Sprint does not have start/finish dates configured",
                }),
              },
            ],
            isError: true,
          };
        }

        // Get work items in the sprint
        const sprintItemsResponse = await azureClient.get<SprintWorkItemsResponse>(
          `/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations/${iterationId}/workitems`
        );

        const workItemRelations = sprintItemsResponse.data.workItemRelations ?? [];
        // Only top-level items (rel === null means direct sprint member)
        const itemIds = workItemRelations
          .filter((r) => r.rel === null)
          .map((r) => r.target.id);

        let totalWork = 0;

        if (itemIds.length > 0) {
          const ids = itemIds.join(",");
          const detailsResponse = await azureClient.get<ApiListResponse<WorkItem>>(
            `/_apis/wit/workitems`,
            {
              params: {
                ids,
                fields: "Microsoft.VSTS.Scheduling.StoryPoints",
              },
            }
          );

          let hasStoryPoints = false;
          for (const wi of detailsResponse.data.value) {
            const sp = wi.fields["Microsoft.VSTS.Scheduling.StoryPoints"];
            if (sp !== undefined && sp !== null) {
              totalWork += sp;
              hasStoryPoints = true;
            }
          }
          // Fall back to item count if no story points are set
          if (!hasStoryPoints) {
            totalWork = itemIds.length;
          }
        }

        // Generate daily burndown data
        const start = new Date(startDate);
        const finish = new Date(finishDate);
        const totalDays = Math.max(
          1,
          Math.round((finish.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
        );

        const dailyData: Array<{ date: string; remaining: number; ideal: number }> = [];
        let dayIndex = 0;
        const current = new Date(start);

        while (current <= finish) {
          const ideal =
            Math.round(
              (totalWork - (totalWork * dayIndex) / totalDays) * 100
            ) / 100;

          dailyData.push({
            date: current.toISOString().split("T")[0],
            remaining: totalWork,
            ideal,
          });

          current.setDate(current.getDate() + 1);
          dayIndex += 1;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                sprint: {
                  name: sprint.name,
                  startDate,
                  finishDate,
                },
                totalWork,
                dailyData,
              }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // get_quality_metrics — Requirements 11.6, 11.8
  // ---------------------------------------------------------------------------
  server.tool(
    "get_quality_metrics",
    "Returns quality metrics for a team: bug reopen rate, mean time to resolve bugs (MTTR) in days, count of stale PRs without review activity for more than STALE_PR_DAYS days, and count of User Stories without acceptance criteria. All calculations are done server-side.",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name"),
      repositoryId: z
        .string()
        .optional()
        .describe("Git repository ID for stale PR calculation (optional)"),
    },
    async ({ project, repositoryId }) => {
      try {
        // ── a. Bug reopen rate ──────────────────────────────────────────────
        // Reopened bugs: Active/New bugs that have a ClosedDate (were previously closed)
        const reopenedWiql = `SELECT TOP 500 [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] = 'Bug' AND [System.State] IN ('Active', 'New') AND [Microsoft.VSTS.Common.ClosedDate] <> ''`;

        const closedWiql = `SELECT TOP 500 [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] = 'Bug' AND [System.State] IN ('Closed', 'Done', 'Resolved')`;

        const [reopenedResponse, closedResponse] = await Promise.all([
          azureClient.post<WiqlQueryResult>(
            `/${encodeURIComponent(project)}/_apis/wit/wiql`,
            { query: reopenedWiql }
          ),
          azureClient.post<WiqlQueryResult>(
            `/${encodeURIComponent(project)}/_apis/wit/wiql`,
            { query: closedWiql }
          ),
        ]);

        const reopenedCount = (reopenedResponse.data.workItems ?? []).length;
        const closedCount = (closedResponse.data.workItems ?? []).length;
        const totalBugsForRate = reopenedCount + closedCount;
        const bugReopenRate =
          totalBugsForRate > 0
            ? Math.round((reopenedCount / totalBugsForRate) * 10000) / 10000
            : 0;

        // ── b. Bug MTTR (Mean Time To Resolve) ─────────────────────────────
        let bugMttrDays = 0;
        if (closedCount > 0) {
          const closedIds = (closedResponse.data.workItems ?? [])
            .slice(0, 200)
            .map((r) => r.id)
            .join(",");

          const closedDetailsResponse = await azureClient.get<ApiListResponse<WorkItem>>(
            `/_apis/wit/workitems`,
            {
              params: {
                ids: closedIds,
                fields:
                  "System.CreatedDate,Microsoft.VSTS.Common.ClosedDate",
              },
            }
          );

          const mttrValues: number[] = [];
          for (const wi of closedDetailsResponse.data.value) {
            const created = wi.fields["System.CreatedDate"];
            const closed = wi.fields["Microsoft.VSTS.Common.ClosedDate"];
            if (created && closed) {
              mttrValues.push(daysBetween(created, closed));
            }
          }

          if (mttrValues.length > 0) {
            const sum = mttrValues.reduce((acc, v) => acc + v, 0);
            bugMttrDays = Math.round((sum / mttrValues.length) * 100) / 100;
          }
        }

        // ── c. Stale PRs ────────────────────────────────────────────────────
        let stalePrCount = 0;
        if (repositoryId) {
          const prResponse = await azureClient.get<ApiListResponse<PullRequest>>(
            `/${encodeURIComponent(project)}/_apis/git/repositories/${repositoryId}/pullrequests`,
            { params: { "searchCriteria.status": "active" } }
          );

          const staleCutoff = new Date();
          staleCutoff.setDate(staleCutoff.getDate() - config.STALE_PR_DAYS);

          for (const pr of prResponse.data.value ?? []) {
            const lastUpdate = pr.closedDate ?? pr.creationDate;
            if (new Date(lastUpdate) < staleCutoff) {
              stalePrCount += 1;
            }
          }
        }

        // ── d. User Stories without acceptance criteria ─────────────────────
        const noAcWiql = `SELECT TOP 500 [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] = 'User Story' AND [Microsoft.VSTS.Common.AcceptanceCriteria] = ''`;

        const noAcResponse = await azureClient.post<WiqlQueryResult>(
          `/${encodeURIComponent(project)}/_apis/wit/wiql`,
          { query: noAcWiql }
        );

        const storiesWithoutAcceptanceCriteria = (noAcResponse.data.workItems ?? []).length;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                bugReopenRate,
                bugMttrDays,
                stalePrCount,
                storiesWithoutAcceptanceCriteria,
              }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // get_work_distribution — Requirements 11.7, 11.8
  // ---------------------------------------------------------------------------
  server.tool(
    "get_work_distribution",
    "Returns the count and percentage of completed work items per team member within a date range. All aggregation is done server-side.",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name"),
      startDate: z.string().describe("Start date in ISO 8601 format (e.g. 2024-01-01)"),
      endDate: z.string().describe("End date in ISO 8601 format (e.g. 2024-03-31)"),
    },
    async ({ project, startDate, endDate }) => {
      try {
        const wiql = `SELECT TOP 500 [System.Id],[System.AssignedTo] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.State] = 'Done' AND [Microsoft.VSTS.Common.ClosedDate] >= '${startDate}' AND [Microsoft.VSTS.Common.ClosedDate] <= '${endDate}'`;

        const wiqlResponse = await azureClient.post<WiqlQueryResult>(
          `/${encodeURIComponent(project)}/_apis/wit/wiql`,
          { query: wiql }
        );

        const workItemRefs = wiqlResponse.data.workItems ?? [];
        if (workItemRefs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ total: 0, distribution: [] }),
              },
            ],
          };
        }

        const ids = workItemRefs.map((r) => r.id).join(",");
        const detailsResponse = await azureClient.get<ApiListResponse<WorkItem>>(
          `/_apis/wit/workitems`,
          { params: { ids, fields: "System.AssignedTo" } }
        );

        const countByAssignee: Record<string, number> = {};

        for (const wi of detailsResponse.data.value) {
          const assignedTo = wi.fields["System.AssignedTo"];
          let displayName: string;

          if (typeof assignedTo === "object" && assignedTo !== null) {
            displayName = (assignedTo as { displayName: string }).displayName ?? "Unassigned";
          } else if (typeof assignedTo === "string" && assignedTo.length > 0) {
            displayName = assignedTo;
          } else {
            displayName = "Unassigned";
          }

          countByAssignee[displayName] = (countByAssignee[displayName] ?? 0) + 1;
        }

        const total = detailsResponse.data.value.length;

        const distribution = Object.entries(countByAssignee)
          .map(([assignee, count]) => ({
            assignee,
            count,
            percentage: Math.round((count / total) * 10000) / 100,
          }))
          .sort((a, b) => b.count - a.count);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ total, distribution }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );
}
