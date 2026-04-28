import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { azureClient } from "../azureClient.js";
import type { WorkItem, WorkItemRevision, WorkItemComment, WiqlQueryResult, ApiListResponse } from "../types/azure.js";

// ---------------------------------------------------------------------------
// JSON Patch operation type used for create / update requests
// ---------------------------------------------------------------------------
interface JsonPatchOperation {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
}

export function registerTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // create_work_item — Requirement 5.1
  // -------------------------------------------------------------------------
  server.tool(
    "create_work_item",
    "Create a new work item (Bug, Task, User Story, etc.) in an Azure DevOps project. " +
      "Returns the created work item id, url and all fields.",
    {
      project: z.string().describe("Project name or id"),
      type: z
        .string()
        .describe('Work item type, e.g. "Bug", "Task", "User Story", "Feature", "Epic"'),
      title: z.string().describe("Work item title"),
      description: z.string().optional().describe("HTML description"),
      assignee: z.string().optional().describe("Assignee email or display name"),
      priority: z.number().int().min(1).max(4).optional().describe("Priority (1–4)"),
      tags: z.string().optional().describe("Semicolon-separated tags"),
      areaPath: z.string().optional().describe("Area path"),
      iterationPath: z.string().optional().describe("Iteration / sprint path"),
      parentId: z.number().int().positive().optional().describe("Parent work item id"),
    },
    async ({ project, type, title, description, assignee, priority, tags, areaPath, iterationPath, parentId }) => {
      try {
        const patches: JsonPatchOperation[] = [
          { op: "add", path: "/fields/System.Title", value: title },
        ];

        if (description !== undefined) {
          patches.push({ op: "add", path: "/fields/System.Description", value: description });
        }
        if (assignee !== undefined) {
          patches.push({ op: "add", path: "/fields/System.AssignedTo", value: assignee });
        }
        if (priority !== undefined) {
          patches.push({ op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: priority });
        }
        if (tags !== undefined) {
          patches.push({ op: "add", path: "/fields/System.Tags", value: tags });
        }
        if (areaPath !== undefined) {
          patches.push({ op: "add", path: "/fields/System.AreaPath", value: areaPath });
        }
        if (iterationPath !== undefined) {
          patches.push({ op: "add", path: "/fields/System.IterationPath", value: iterationPath });
        }
        if (parentId !== undefined) {
          patches.push({
            op: "add",
            path: "/relations/-",
            value: {
              rel: "System.LinkTypes.Hierarchy-Reverse",
              url: `/_apis/wit/workitems/${parentId}`,
            },
          });
        }

        const response = await azureClient.post<WorkItem>(
          `/${encodeURIComponent(project)}/_apis/wit/workitems/$${encodeURIComponent(type)}`,
          patches,
          { headers: { "Content-Type": "application/json-patch+json" } }
        );

        const wi = response.data;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: wi.id, url: wi.url, fields: wi.fields }),
            },
          ],
        };
      } catch (err) {
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
    }
  );

  // -------------------------------------------------------------------------
  // get_work_item — Requirement 5.2
  // -------------------------------------------------------------------------
  server.tool(
    "get_work_item",
    "Retrieve all fields (system and custom) of a work item by its numeric id.",
    {
      id: z.number().int().positive().describe("Work item id"),
    },
    async ({ id }) => {
      try {
        const response = await azureClient.get<WorkItem>(
          `/_apis/wit/workitems/${id}`,
          { params: { $expand: "all" } }
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response.data) }],
        };
      } catch (err) {
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
    }
  );

  // -------------------------------------------------------------------------
  // update_work_item — Requirement 5.3
  // -------------------------------------------------------------------------
  server.tool(
    "update_work_item",
    "Apply one or more JSON Patch operations to a work item and return the updated item. " +
      'Example patch: [{ "op": "replace", "path": "/fields/System.State", "value": "Active" }]',
    {
      id: z.number().int().positive().describe("Work item id"),
      patches: z
        .array(
          z.object({
            op: z.enum(["add", "replace", "remove"]),
            path: z.string().describe('JSON Pointer path, e.g. "/fields/System.Title"'),
            value: z.unknown().optional().describe("New value (omit for remove operations)"),
          })
        )
        .min(1)
        .describe("Array of JSON Patch operations to apply"),
    },
    async ({ id, patches }) => {
      try {
        const response = await azureClient.patch<WorkItem>(
          `/_apis/wit/workitems/${id}`,
          patches,
          { headers: { "Content-Type": "application/json-patch+json" } }
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response.data) }],
        };
      } catch (err) {
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
    }
  );

  // -------------------------------------------------------------------------
  // delete_work_item — Requirement 5.5
  // -------------------------------------------------------------------------
  server.tool(
    "delete_work_item",
    "Move a work item to the recycle bin by its numeric id. Returns a confirmation message.",
    {
      id: z.number().int().positive().describe("Work item id"),
    },
    async ({ id }) => {
      try {
        await azureClient.delete(`/_apis/wit/workitems/${id}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ message: `Work item ${id} moved to recycle bin.`, id }),
            },
          ],
        };
      } catch (err) {
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
    }
  );

  // -------------------------------------------------------------------------
  // list_work_items — Requirement 5.4
  // -------------------------------------------------------------------------
  server.tool(
    "list_work_items",
    "List work items in a project using WIQL with optional filters for type, state, assignee, sprint and area path.",
    {
      project: z.string().describe("Project name or id"),
      type: z.string().optional().describe('Work item type filter, e.g. "Bug", "Task"'),
      state: z.string().optional().describe('State filter, e.g. "Active", "Closed"'),
      assignee: z.string().optional().describe("Assignee email or display name"),
      sprint: z.string().optional().describe("Iteration path (sprint) filter"),
      areaPath: z.string().optional().describe("Area path filter"),
    },
    async ({ project, type, state, assignee, sprint, areaPath }) => {
      try {
        let wiql =
          `SELECT [System.Id],[System.Title],[System.WorkItemType],[System.State],[System.AssignedTo] ` +
          `FROM WorkItems WHERE [System.TeamProject] = '${project}'`;

        if (type !== undefined) {
          wiql += ` AND [System.WorkItemType] = '${type}'`;
        }
        if (state !== undefined) {
          wiql += ` AND [System.State] = '${state}'`;
        }
        if (assignee !== undefined) {
          wiql += ` AND [System.AssignedTo] = '${assignee}'`;
        }
        if (sprint !== undefined) {
          wiql += ` AND [System.IterationPath] = '${sprint}'`;
        }
        if (areaPath !== undefined) {
          wiql += ` AND [System.AreaPath] = '${areaPath}'`;
        }

        const wiqlResponse = await azureClient.post<WiqlQueryResult>(
          `/${encodeURIComponent(project)}/_apis/wit/wiql`,
          { query: wiql }
        );

        const refs = wiqlResponse.data.workItems;
        if (refs.length === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify([]) }],
          };
        }

        const ids = refs.map((r) => r.id).join(",");
        const detailsResponse = await azureClient.get<ApiListResponse<WorkItem>>(
          `/_apis/wit/workitems`,
          {
            params: {
              ids,
              $select:
                "System.Id,System.Title,System.WorkItemType,System.State,System.AssignedTo",
            },
          }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(detailsResponse.data.value),
            },
          ],
        };
      } catch (err) {
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
    }
  );

  // -------------------------------------------------------------------------
  // add_comment — Requirement 5.6
  // -------------------------------------------------------------------------
  server.tool(
    "add_comment",
    "Add a comment to a work item. Returns the comment id and creation timestamp.",
    {
      project: z.string().describe("Project name or id"),
      id: z.number().int().positive().describe("Work item id"),
      text: z.string().describe("Comment text (supports HTML)"),
    },
    async ({ project, id, text }) => {
      try {
        const response = await azureClient.post<WorkItemComment>(
          `/${encodeURIComponent(project)}/_apis/wit/workitems/${id}/comments`,
          { text }
        );
        const comment = response.data;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: comment.id, createdDate: comment.createdDate }),
            },
          ],
        };
      } catch (err) {
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
    }
  );

  // -------------------------------------------------------------------------
  // get_work_item_history — Requirement 5.7
  // -------------------------------------------------------------------------
  server.tool(
    "get_work_item_history",
    "Retrieve the full revision history of a work item including changed fields, old/new values and the identity of who made each change.",
    {
      id: z.number().int().positive().describe("Work item id"),
    },
    async ({ id }) => {
      try {
        const response = await azureClient.get<ApiListResponse<WorkItemRevision>>(
          `/_apis/wit/workitems/${id}/revisions`,
          { params: { $expand: "all" } }
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response.data.value),
            },
          ],
        };
      } catch (err) {
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
    }
  );

  // -------------------------------------------------------------------------
  // link_work_items — Requirement 5.9
  // -------------------------------------------------------------------------
  server.tool(
    "link_work_items",
    "Create a relation between two work items. Returns the updated source work item.",
    {
      sourceId: z.number().int().positive().describe("Source work item id"),
      targetId: z.number().int().positive().describe("Target work item id"),
      relationType: z
        .string()
        .describe(
          'Relation type, e.g. "System.LinkTypes.Related", "System.LinkTypes.Hierarchy-Forward"'
        ),
    },
    async ({ sourceId, targetId, relationType }) => {
      try {
        const patch: JsonPatchOperation[] = [
          {
            op: "add",
            path: "/relations/-",
            value: {
              rel: relationType,
              url: `/_apis/wit/workitems/${targetId}`,
            },
          },
        ];

        const response = await azureClient.patch<WorkItem>(
          `/_apis/wit/workitems/${sourceId}`,
          patch,
          { headers: { "Content-Type": "application/json-patch+json" } }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response.data),
            },
          ],
        };
      } catch (err) {
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
    }
  );

  // -------------------------------------------------------------------------
  // bulk_create_work_items — Requirement 5.8
  // -------------------------------------------------------------------------
  server.tool(
    "bulk_create_work_items",
    "Create multiple work items in a single call. Iterates over each item definition sequentially " +
      "and returns a result list with success status, id and url per item, or an error message if creation failed.",
    {
      project: z.string().describe("Project name or id"),
      items: z
        .array(
          z.object({
            type: z.string().describe('Work item type, e.g. "Bug", "Task", "User Story"'),
            title: z.string().describe("Work item title"),
            description: z.string().optional().describe("HTML description"),
            assignee: z.string().optional().describe("Assignee email or display name"),
            priority: z.number().int().min(1).max(4).optional().describe("Priority (1–4)"),
            tags: z.string().optional().describe("Semicolon-separated tags"),
            areaPath: z.string().optional().describe("Area path"),
            iterationPath: z.string().optional().describe("Iteration / sprint path"),
            parentId: z.number().int().positive().optional().describe("Parent work item id"),
          })
        )
        .min(1)
        .describe("List of work item definitions to create"),
    },
    async ({ project, items }) => {
      interface BulkCreateResult {
        index: number;
        success: boolean;
        id?: number;
        url?: string;
        error?: string;
      }

      const results: BulkCreateResult[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          const patches: JsonPatchOperation[] = [
            { op: "add", path: "/fields/System.Title", value: item.title },
          ];

          if (item.description !== undefined) {
            patches.push({ op: "add", path: "/fields/System.Description", value: item.description });
          }
          if (item.assignee !== undefined) {
            patches.push({ op: "add", path: "/fields/System.AssignedTo", value: item.assignee });
          }
          if (item.priority !== undefined) {
            patches.push({ op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: item.priority });
          }
          if (item.tags !== undefined) {
            patches.push({ op: "add", path: "/fields/System.Tags", value: item.tags });
          }
          if (item.areaPath !== undefined) {
            patches.push({ op: "add", path: "/fields/System.AreaPath", value: item.areaPath });
          }
          if (item.iterationPath !== undefined) {
            patches.push({ op: "add", path: "/fields/System.IterationPath", value: item.iterationPath });
          }
          if (item.parentId !== undefined) {
            patches.push({
              op: "add",
              path: "/relations/-",
              value: {
                rel: "System.LinkTypes.Hierarchy-Reverse",
                url: `/_apis/wit/workitems/${item.parentId}`,
              },
            });
          }

          const response = await azureClient.post<WorkItem>(
            `/${encodeURIComponent(project)}/_apis/wit/workitems/${encodeURIComponent(item.type)}`,
            patches,
            { headers: { "Content-Type": "application/json-patch+json" } }
          );

          const wi = response.data;
          results.push({ index: i, success: true, id: wi.id, url: wi.url });
        } catch (err) {
          const error = err as Error;
          results.push({ index: i, success: false, error: error.message });
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(results),
          },
        ],
      };
    }
  );
}
