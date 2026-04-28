import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { azureClient } from "../azureClient.js";
import type {
  ApiListResponse,
  IdentityRef,
  Sprint,
  WiqlQueryResult,
  WorkItem,
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
        text: JSON.stringify({
          error: error.message,
          statusCode: error.statusCode ?? 500,
        }),
      },
    ],
    isError: true,
  };
}

const DONE_STATES = new Set(["Done", "Closed", "Resolved"]);

function resolveAssignee(
  assignedTo: IdentityRef | string | undefined
): string {
  if (!assignedTo) return "Unassigned";
  if (typeof assignedTo === "string") return assignedTo || "Unassigned";
  return assignedTo.displayName || "Unassigned";
}

async function fetchWorkItemDetails(
  ids: number[],
  fields: string
): Promise<WorkItem[]> {
  if (ids.length === 0) return [];
  const detailsResponse = await azureClient.get<ApiListResponse<WorkItem>>(
    `/_apis/wit/workitems`,
    { params: { ids: ids.join(","), fields } }
  );
  return detailsResponse.data.value ?? [];
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // get_sprint_summary — Requirement 12.1
  // -------------------------------------------------------------------------
  server.tool(
    "get_sprint_summary",
    "Returns a summary of a sprint including planned vs completed items and story points, carried-over items, and bugs opened/closed. All calculations are done server-side.",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name"),
      iterationId: z.string().describe("Sprint iteration ID (GUID)"),
    },
    async ({ project, team, iterationId }) => {
      try {
        // Fetch sprint metadata and work item relations in parallel
        const [sprintResponse, sprintItemsResponse] = await Promise.all([
          azureClient.get<Sprint>(
            `/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations/${iterationId}`
          ),
          azureClient.get<SprintWorkItemsResponse>(
            `/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations/${iterationId}/workitems`
          ),
        ]);

        const sprint = sprintResponse.data;
        const relations = sprintItemsResponse.data.workItemRelations ?? [];

        // Only top-level items (rel === null means direct sprint member)
        const itemIds = relations
          .filter((r) => r.rel === null)
          .map((r) => r.target.id);

        if (itemIds.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  sprint: { name: sprint.name, id: sprint.id },
                  plannedItems: 0,
                  completedItems: 0,
                  plannedStoryPoints: 0,
                  completedStoryPoints: 0,
                  carriedOverItems: 0,
                  bugsOpened: 0,
                  bugsClosed: 0,
                }),
              },
            ],
          };
        }

        const workItems = await fetchWorkItemDetails(
          itemIds,
          "System.State,System.WorkItemType,Microsoft.VSTS.Scheduling.StoryPoints"
        );

        const plannedItems = workItems.length;
        let completedItems = 0;
        let plannedStoryPoints = 0;
        let completedStoryPoints = 0;
        let bugsOpened = 0;
        let bugsClosed = 0;

        for (const wi of workItems) {
          const state = wi.fields["System.State"];
          const type = wi.fields["System.WorkItemType"];
          const sp = wi.fields["Microsoft.VSTS.Scheduling.StoryPoints"] ?? 0;
          const isDone = DONE_STATES.has(state);
          const isBug = type === "Bug";

          plannedStoryPoints += sp;

          if (isDone) {
            completedItems += 1;
            completedStoryPoints += sp;
          }

          if (isBug) {
            bugsOpened += 1;
            if (isDone) bugsClosed += 1;
          }
        }

        const carriedOverItems = plannedItems - completedItems;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                sprint: { name: sprint.name, id: sprint.id },
                plannedItems,
                completedItems,
                plannedStoryPoints: Math.round(plannedStoryPoints * 100) / 100,
                completedStoryPoints:
                  Math.round(completedStoryPoints * 100) / 100,
                carriedOverItems,
                bugsOpened,
                bugsClosed,
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
  // generate_release_notes — Requirement 12.2
  // -------------------------------------------------------------------------
  server.tool(
    "generate_release_notes",
    "Generates release notes for work items closed in a period, grouped by type (features, bug fixes, improvements). Supports optional filters (tag, area path, sprint) and output format (markdown or html).",
    {
      project: z.string().describe("Project name or ID"),
      startDate: z
        .string()
        .optional()
        .describe("Start date in ISO 8601 format (e.g. 2024-01-01)"),
      endDate: z
        .string()
        .optional()
        .describe("End date in ISO 8601 format (e.g. 2024-03-31)"),
      sprint: z
        .string()
        .optional()
        .describe("Sprint / iteration path to filter by"),
      tag: z.string().optional().describe("Tag to filter work items by"),
      areaPath: z.string().optional().describe("Area path to filter by"),
      format: z
        .enum(["markdown", "html"])
        .default("markdown")
        .describe("Output format: markdown (default) or html"),
    },
    async ({ project, startDate, endDate, sprint, tag, areaPath, format }) => {
      try {
        // Build WIQL conditions
        const conditions: string[] = [
          `[System.TeamProject] = '${project}'`,
          `[System.State] IN ('Done', 'Closed', 'Resolved')`,
        ];

        if (startDate) {
          conditions.push(
            `[Microsoft.VSTS.Common.ClosedDate] >= '${startDate}'`
          );
        }
        if (endDate) {
          conditions.push(
            `[Microsoft.VSTS.Common.ClosedDate] <= '${endDate}'`
          );
        }
        if (sprint) {
          conditions.push(`[System.IterationPath] = '${sprint}'`);
        }
        if (tag) {
          conditions.push(`[System.Tags] CONTAINS '${tag}'`);
        }
        if (areaPath) {
          conditions.push(`[System.AreaPath] UNDER '${areaPath}'`);
        }

        const wiql = `SELECT TOP 500 [System.Id],[System.WorkItemType],[System.Title] FROM WorkItems WHERE ${conditions.join(" AND ")} ORDER BY [System.WorkItemType] ASC`;

        const wiqlResponse = await azureClient.post<WiqlQueryResult>(
          `/${encodeURIComponent(project)}/_apis/wit/wiql`,
          { query: wiql }
        );

        const refs = wiqlResponse.data.workItems ?? [];

        if (refs.length === 0) {
          const emptyNote =
            format === "html"
              ? "<h1>Release Notes</h1><p>No closed work items found for the specified criteria.</p>"
              : "# Release Notes\n\nNo closed work items found for the specified criteria.";
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ notes: emptyNote }) }],
          };
        }

        const workItems = await fetchWorkItemDetails(
          refs.map((r) => r.id),
          "System.WorkItemType,System.Title"
        );

        // Group by type
        const grouped: Record<string, Array<{ id: number; title: string }>> =
          {};
        for (const wi of workItems) {
          const type = wi.fields["System.WorkItemType"];
          const title = wi.fields["System.Title"];
          if (!grouped[type]) grouped[type] = [];
          grouped[type].push({ id: wi.id, title });
        }

        // Map type names to friendly section headings
        function sectionTitle(type: string): string {
          const map: Record<string, string> = {
            Feature: "Features",
            "User Story": "Improvements",
            Bug: "Bug Fixes",
            Task: "Tasks",
            Epic: "Epics",
          };
          return map[type] ?? type;
        }

        let notes: string;

        if (format === "html") {
          const sections = Object.entries(grouped)
            .map(([type, items]) => {
              const listItems = items
                .map((i) => `<li>[${i.id}] ${i.title}</li>`)
                .join("");
              return `<h2>${sectionTitle(type)}</h2><ul>${listItems}</ul>`;
            })
            .join("");
          notes = `<h1>Release Notes</h1>${sections}`;
        } else {
          const sections = Object.entries(grouped)
            .map(([type, items]) => {
              const listItems = items
                .map((i) => `- [${i.id}] ${i.title}`)
                .join("\n");
              return `## ${sectionTitle(type)}\n${listItems}`;
            })
            .join("\n\n");
          notes = `# Release Notes\n\n${sections}`;
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ notes }) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // get_incomplete_items_report — Requirement 12.3
  // -------------------------------------------------------------------------
  server.tool(
    "get_incomplete_items_report",
    "Returns all incomplete work items in a sprint with id, title, type, assignee, state, and number of days the item has been open.",
    {
      project: z.string().describe("Project name or ID"),
      iterationId: z.string().describe("Sprint iteration ID (GUID)"),
    },
    async ({ project, iterationId }) => {
      try {
        // WIQL: items in the sprint that are NOT done
        const wiql = `SELECT TOP 500 [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.IterationId] = '${iterationId}' AND [System.State] NOT IN ('Done', 'Closed', 'Resolved')`;

        const wiqlResponse = await azureClient.post<WiqlQueryResult>(
          `/${encodeURIComponent(project)}/_apis/wit/wiql`,
          { query: wiql }
        );

        const refs = wiqlResponse.data.workItems ?? [];

        if (refs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ items: [] }),
              },
            ],
          };
        }

        const workItems = await fetchWorkItemDetails(
          refs.map((r) => r.id),
          "System.Title,System.WorkItemType,System.AssignedTo,System.State,System.CreatedDate"
        );

        const now = Date.now();

        const items = workItems.map((wi) => {
          const createdDate = wi.fields["System.CreatedDate"];
          const daysOpen = createdDate
            ? Math.floor(
                (now - new Date(createdDate).getTime()) / (1000 * 60 * 60 * 24)
              )
            : 0;

          return {
            id: wi.id,
            title: wi.fields["System.Title"],
            type: wi.fields["System.WorkItemType"],
            assignee: resolveAssignee(wi.fields["System.AssignedTo"]),
            state: wi.fields["System.State"],
            daysOpen,
          };
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ items }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );
}
