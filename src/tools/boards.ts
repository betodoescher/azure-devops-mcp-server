import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { azureClient } from "../azureClient.js";
import type { ApiListResponse, Board, BoardColumn, Sprint, WorkItem } from "../types/azure.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

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

// ---------------------------------------------------------------------------
// Sprint work items response shape
// ---------------------------------------------------------------------------

interface IterationWorkItemsResponse {
  workItemRelations: Array<{
    target?: { id: number; url: string };
    rel?: string | null;
    source?: { id: number; url: string } | null;
  }>;
  url: string;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // list_boards — Requirement 6.1
  server.tool(
    "list_boards",
    "List all boards for a given Azure DevOps team, returning id, name and boardType for each board.",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name or ID"),
    },
    async ({ project, team }) => {
      try {
        const response = await azureClient.get<ApiListResponse<Board>>(
          `/${encodeSegment(project)}/${encodeSegment(team)}/_apis/work/boards`
        );
        const boards = response.data.value.map((b) => ({
          id: b.id,
          name: b.name,
          boardType: b.boardType,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(boards) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // get_board_columns — Requirement 6.2
  server.tool(
    "get_board_columns",
    "Get all columns of a specific board, including name, stateMappings, isSplit and itemLimit.",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name or ID"),
      boardId: z.string().describe("Board ID or name"),
    },
    async ({ project, team, boardId }) => {
      try {
        const response = await azureClient.get<ApiListResponse<BoardColumn>>(
          `/${encodeSegment(project)}/${encodeSegment(team)}/_apis/work/boards/${encodeSegment(boardId)}/columns`
        );
        const columns = response.data.value.map((c) => ({
          name: c.name,
          stateMappings: c.stateMappings,
          isSplit: c.isSplit,
          itemLimit: c.itemLimit,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(columns) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // list_sprints — Requirement 6.3
  server.tool(
    "list_sprints",
    "List all sprints (iterations) for a given team, returning id, name, path and attributes (startDate, finishDate, timeFrame).",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name or ID"),
    },
    async ({ project, team }) => {
      try {
        const response = await azureClient.get<ApiListResponse<Sprint>>(
          `/${encodeSegment(project)}/${encodeSegment(team)}/_apis/work/teamsettings/iterations`
        );
        const sprints = response.data.value.map((s) => ({
          id: s.id,
          name: s.name,
          path: s.path,
          attributes: {
            startDate: s.attributes.startDate,
            finishDate: s.attributes.finishDate,
            timeFrame: s.attributes.timeFrame,
          },
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(sprints) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // get_current_sprint — Requirement 6.4
  server.tool(
    "get_current_sprint",
    "Get the currently active sprint for a given team. Returns the sprint details or an informative message if no sprint is currently active.",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name or ID"),
    },
    async ({ project, team }) => {
      try {
        const response = await azureClient.get<ApiListResponse<Sprint>>(
          `/${encodeSegment(project)}/${encodeSegment(team)}/_apis/work/teamsettings/iterations`,
          { params: { $timeframe: "current" } }
        );
        const current = response.data.value[0];
        if (!current) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ message: "No active sprint found for this team." }),
              },
            ],
          };
        }
        const sprint = {
          id: current.id,
          name: current.name,
          path: current.path,
          attributes: {
            startDate: current.attributes.startDate,
            finishDate: current.attributes.finishDate,
            timeFrame: current.attributes.timeFrame,
          },
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(sprint) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // get_sprint_work_items — Requirement 6.5
  server.tool(
    "get_sprint_work_items",
    "Get all work items assigned to a specific sprint, returning id, title, type, state and assignee for each item.",
    {
      project: z.string().describe("Project name or ID"),
      team: z.string().describe("Team name or ID"),
      iterationId: z.string().describe("Sprint/Iteration ID"),
    },
    async ({ project, team, iterationId }) => {
      try {
        // Step 1: get work item relations for the iteration
        const relationsResponse = await azureClient.get<IterationWorkItemsResponse>(
          `/${encodeSegment(project)}/${encodeSegment(team)}/_apis/work/teamsettings/iterations/${encodeSegment(iterationId)}/workitems`
        );

        const ids = relationsResponse.data.workItemRelations
          .map((r) => r.target?.id)
          .filter((id): id is number => id !== undefined);

        if (ids.length === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify([]) }],
          };
        }

        // Step 2: fetch work item details
        const detailsResponse = await azureClient.get<ApiListResponse<WorkItem>>(
          `/_apis/wit/workitems`,
          {
            params: {
              ids: ids.join(","),
              $select:
                "System.Id,System.Title,System.WorkItemType,System.State,System.AssignedTo",
            },
          }
        );

        const workItems = detailsResponse.data.value.map((wi) => {
          const assignedTo = wi.fields["System.AssignedTo"];
          const assignee =
            typeof assignedTo === "object" && assignedTo !== null
              ? (assignedTo as { displayName?: string }).displayName
              : (assignedTo as string | undefined);
          return {
            id: wi.fields["System.Id"],
            title: wi.fields["System.Title"],
            type: wi.fields["System.WorkItemType"],
            state: wi.fields["System.State"],
            assignee: assignee ?? null,
          };
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(workItems) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );
}
