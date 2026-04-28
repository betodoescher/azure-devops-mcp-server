import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { azureClient } from "../azureClient.js";
import type { WiqlQueryResult, WorkItem } from "../types/azure.js";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface JsonPatchOperation {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
}

interface ItemResult {
  id: number;
  success: boolean;
  error?: string;
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

async function patchWorkItem(
  id: number,
  patches: JsonPatchOperation[]
): Promise<void> {
  await azureClient.patch<WorkItem>(
    `/_apis/wit/workitems/${id}`,
    patches,
    { headers: { "Content-Type": "application/json-patch+json" } }
  );
}

async function resolveIdsFromWiql(
  project: string,
  wiqlQuery: string
): Promise<number[]> {
  const response = await azureClient.post<WiqlQueryResult>(
    `/${encodeURIComponent(project)}/_apis/wit/wiql`,
    { query: wiqlQuery }
  );
  return (response.data.workItems ?? []).map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // bulk_move_sprint_items — Requirement 13.1
  // -------------------------------------------------------------------------
  server.tool(
    "bulk_move_sprint_items",
    "Move all work items from a source sprint to a target sprint. " +
      "Supports optional filters for state and work item type. " +
      "Returns the count of affected items and a per-item result list.",
    {
      project: z.string().describe("Project name or id"),
      sourceIterationPath: z.string().describe("Source sprint / iteration path"),
      targetIterationPath: z.string().describe("Target sprint / iteration path"),
      state: z.string().optional().describe("Optional state filter, e.g. \"Active\""),
      type: z.string().optional().describe("Optional work item type filter, e.g. \"Task\""),
    },
    async ({ project, sourceIterationPath, targetIterationPath, state, type }) => {
      try {
        const conditions: string[] = [
          `[System.TeamProject] = '${project}'`,
          `[System.IterationPath] = '${sourceIterationPath}'`,
        ];
        if (state !== undefined) {
          conditions.push(`[System.State] = '${state}'`);
        }
        if (type !== undefined) {
          conditions.push(`[System.WorkItemType] = '${type}'`);
        }

        const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${conditions.join(" AND ")}`;
        const ids = await resolveIdsFromWiql(project, wiql);

        const results: ItemResult[] = [];

        for (const id of ids) {
          try {
            await patchWorkItem(id, [
              { op: "replace", path: "/fields/System.IterationPath", value: targetIterationPath },
            ]);
            results.push({ id, success: true });
          } catch (err) {
            const error = err as Error;
            results.push({ id, success: false, error: error.message });
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ affectedCount: results.length, results }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // bulk_reassign_work_items — Requirement 13.2
  // -------------------------------------------------------------------------
  server.tool(
    "bulk_reassign_work_items",
    "Reassign all work items from one assignee to another. " +
      "Supports optional filters for state, work item type and sprint. " +
      "Returns the count of affected items and a per-item result list.",
    {
      project: z.string().describe("Project name or id"),
      fromAssignee: z.string().describe("Current assignee email or display name"),
      toAssignee: z.string().describe("New assignee email or display name"),
      state: z.string().optional().describe("Optional state filter, e.g. \"Active\""),
      type: z.string().optional().describe("Optional work item type filter, e.g. \"Bug\""),
      sprint: z.string().optional().describe("Optional sprint / iteration path filter"),
    },
    async ({ project, fromAssignee, toAssignee, state, type, sprint }) => {
      try {
        const conditions: string[] = [
          `[System.TeamProject] = '${project}'`,
          `[System.AssignedTo] = '${fromAssignee}'`,
        ];
        if (state !== undefined) {
          conditions.push(`[System.State] = '${state}'`);
        }
        if (type !== undefined) {
          conditions.push(`[System.WorkItemType] = '${type}'`);
        }
        if (sprint !== undefined) {
          conditions.push(`[System.IterationPath] = '${sprint}'`);
        }

        const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${conditions.join(" AND ")}`;
        const ids = await resolveIdsFromWiql(project, wiql);

        const results: ItemResult[] = [];

        for (const id of ids) {
          try {
            await patchWorkItem(id, [
              { op: "replace", path: "/fields/System.AssignedTo", value: toAssignee },
            ]);
            results.push({ id, success: true });
          } catch (err) {
            const error = err as Error;
            results.push({ id, success: false, error: error.message });
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ affectedCount: results.length, results }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // bulk_close_work_items — Requirement 13.3
  // -------------------------------------------------------------------------
  server.tool(
    "bulk_close_work_items",
    "Close multiple work items by setting their state to \"Closed\". " +
      "Accepts either a list of work item ids or a WIQL query string (at least one required). " +
      "Returns a per-item result list.",
    {
      project: z.string().describe("Project name or id"),
      ids: z
        .array(z.number().int().positive())
        .optional()
        .describe("List of work item ids to close"),
      wiqlQuery: z
        .string()
        .optional()
        .describe("WIQL query string to select work items to close"),
    },
    async ({ project, ids, wiqlQuery }) => {
      try {
        if ((ids === undefined || ids.length === 0) && !wiqlQuery) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "At least one of 'ids' or 'wiqlQuery' must be provided.",
                }),
              },
            ],
            isError: true,
          };
        }

        let targetIds: number[] = ids ?? [];

        if (wiqlQuery) {
          const queriedIds = await resolveIdsFromWiql(project, wiqlQuery);
          // Merge, deduplicating
          const idSet = new Set<number>([...targetIds, ...queriedIds]);
          targetIds = Array.from(idSet);
        }

        const results: ItemResult[] = [];

        for (const id of targetIds) {
          try {
            await patchWorkItem(id, [
              { op: "replace", path: "/fields/System.State", value: "Closed" },
            ]);
            results.push({ id, success: true });
          } catch (err) {
            const error = err as Error;
            results.push({ id, success: false, error: error.message });
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ results }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // bulk_apply_tags — Requirement 13.4
  // -------------------------------------------------------------------------
  server.tool(
    "bulk_apply_tags",
    "Add or remove a tag on all work items matching the given filter criteria. " +
      "Tags are semicolon-separated in Azure DevOps. " +
      "Returns the count of affected items.",
    {
      project: z.string().describe("Project name or id"),
      tag: z.string().describe("Tag to add or remove"),
      action: z.enum(["add", "remove"]).describe("Whether to add or remove the tag"),
      type: z.string().optional().describe("Optional work item type filter"),
      areaPath: z.string().optional().describe("Optional area path filter"),
      sprint: z.string().optional().describe("Optional sprint / iteration path filter"),
      state: z.string().optional().describe("Optional state filter"),
    },
    async ({ project, tag, action, type, areaPath, sprint, state }) => {
      try {
        const conditions: string[] = [
          `[System.TeamProject] = '${project}'`,
        ];
        if (type !== undefined) {
          conditions.push(`[System.WorkItemType] = '${type}'`);
        }
        if (areaPath !== undefined) {
          conditions.push(`[System.AreaPath] UNDER '${areaPath}'`);
        }
        if (sprint !== undefined) {
          conditions.push(`[System.IterationPath] = '${sprint}'`);
        }
        if (state !== undefined) {
          conditions.push(`[System.State] = '${state}'`);
        }

        const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${conditions.join(" AND ")}`;
        const ids = await resolveIdsFromWiql(project, wiql);

        if (ids.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ affectedCount: 0 }),
              },
            ],
          };
        }

        // Fetch current tags for all items in one request
        const detailsResponse = await azureClient.get<{ value: WorkItem[] }>(
          `/_apis/wit/workitems`,
          { params: { ids: ids.join(","), fields: "System.Tags" } }
        );
        const itemsWithTags = detailsResponse.data.value ?? [];

        // Build a map of id -> current tags string
        const tagsMap = new Map<number, string>();
        for (const wi of itemsWithTags) {
          tagsMap.set(wi.id, wi.fields["System.Tags"] ?? "");
        }

        let affectedCount = 0;

        for (const id of ids) {
          const currentTagsRaw = tagsMap.get(id) ?? "";
          const currentTags = currentTagsRaw
            .split(";")
            .map((t) => t.trim())
            .filter((t) => t.length > 0);

          let newTags: string[];

          if (action === "add") {
            if (currentTags.includes(tag)) continue; // already present, skip
            newTags = [...currentTags, tag];
          } else {
            if (!currentTags.includes(tag)) continue; // not present, skip
            newTags = currentTags.filter((t) => t !== tag);
          }

          try {
            await patchWorkItem(id, [
              { op: "replace", path: "/fields/System.Tags", value: newTags.join("; ") },
            ]);
            affectedCount += 1;
          } catch {
            // Count only successful updates
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ affectedCount }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // bulk_update_field — Requirement 13.5
  // -------------------------------------------------------------------------
  server.tool(
    "bulk_update_field",
    "Update a single field to a new value on multiple work items. " +
      "Accepts either a list of work item ids or a WIQL query string (at least one required). " +
      "Returns a per-item result list.",
    {
      project: z.string().describe("Project name or id"),
      fieldName: z
        .string()
        .describe("Field reference name, e.g. \"System.State\" or \"Microsoft.VSTS.Common.Priority\""),
      value: z.unknown().describe("New value to set for the field"),
      ids: z
        .array(z.number().int().positive())
        .optional()
        .describe("List of work item ids to update"),
      wiqlQuery: z
        .string()
        .optional()
        .describe("WIQL query string to select work items to update"),
    },
    async ({ project, fieldName, value, ids, wiqlQuery }) => {
      try {
        if ((ids === undefined || ids.length === 0) && !wiqlQuery) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "At least one of 'ids' or 'wiqlQuery' must be provided.",
                }),
              },
            ],
            isError: true,
          };
        }

        let targetIds: number[] = ids ?? [];

        if (wiqlQuery) {
          const queriedIds = await resolveIdsFromWiql(project, wiqlQuery);
          const idSet = new Set<number>([...targetIds, ...queriedIds]);
          targetIds = Array.from(idSet);
        }

        const results: ItemResult[] = [];

        for (const id of targetIds) {
          try {
            await patchWorkItem(id, [
              { op: "replace", path: `/fields/${fieldName}`, value },
            ]);
            results.push({ id, success: true });
          } catch (err) {
            const error = err as Error;
            results.push({ id, success: false, error: error.message });
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ results }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );
}
