import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { azureClient } from "../azureClient.js";
import type {
  ApiListResponse,
  SavedQuery,
  WiqlQueryResult,
  WorkItem,
} from "../types/azure.js";

// ---------------------------------------------------------------------------
// Helpers
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

/**
 * Sanitize a WIQL query string to prevent parameter injection.
 * - Removes `--` line comments
 * - Removes `/* ... *\/` block comments
 * - Removes semicolons
 * - Trims whitespace
 * - Validates the query starts with SELECT or ORDER
 *
 * Requirement 10.3
 */
function sanitizeWiql(query: string): string | null {
  // Remove block comments /* ... */
  let sanitized = query.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Remove line comments --
  sanitized = sanitized.replace(/--[^\r\n]*/g, " ");
  // Remove semicolons
  sanitized = sanitized.replace(/;/g, "");
  // Collapse extra whitespace
  sanitized = sanitized.trim().replace(/\s+/g, " ");

  // Basic validation: must start with SELECT or ORDER
  if (!/^(SELECT|ORDER)\b/i.test(sanitized)) {
    return null;
  }

  return sanitized;
}

// ---------------------------------------------------------------------------
// Saved query tree flattening
// ---------------------------------------------------------------------------

interface QueryTreeNode {
  id: string;
  name: string;
  path: string;
  queryType?: string;
  isFolder?: boolean;
  children?: QueryTreeNode[];
}

function flattenQueryTree(nodes: QueryTreeNode[]): SavedQuery[] {
  const result: SavedQuery[] = [];
  for (const node of nodes) {
    if (!node.isFolder) {
      result.push({
        id: node.id,
        name: node.name,
        path: node.path,
        queryType: node.queryType ?? "flat",
      });
    }
    if (node.children && node.children.length > 0) {
      result.push(...flattenQueryTree(node.children));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // run_wiql_query — Requirements 10.1, 10.3
  server.tool(
    "run_wiql_query",
    "Execute a WIQL (Work Item Query Language) query against an Azure DevOps project and return matching work items with id, title, type, state and assignee.",
    {
      project: z.string().describe("Project name or ID"),
      query: z.string().describe("WIQL query string (e.g. SELECT [System.Id] FROM WorkItems WHERE ...)"),
    },
    async ({ project, query }) => {
      try {
        const sanitized = sanitizeWiql(query);
        if (sanitized === null) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "Invalid WIQL query: must start with SELECT or ORDER and must not contain injection patterns.",
                  statusCode: 400,
                }),
              },
            ],
            isError: true,
          };
        }

        // POST the WIQL query
        const wiqlResponse = await azureClient.post<WiqlQueryResult>(
          `/${encodeSegment(project)}/_apis/wit/wiql`,
          { query: sanitized }
        );

        const workItemRefs = wiqlResponse.data.workItems;
        if (!workItemRefs || workItemRefs.length === 0) {
          return { content: [{ type: "text" as const, text: JSON.stringify([]) }] };
        }

        // Fetch details for the returned work item IDs
        const ids = workItemRefs.map((ref) => ref.id).join(",");
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

        const items = detailsResponse.data.value.map((wi) => {
          const assignedTo = wi.fields["System.AssignedTo"];
          const assignee =
            typeof assignedTo === "object" && assignedTo !== null
              ? (assignedTo as { displayName?: string }).displayName ?? null
              : (assignedTo as string | undefined) ?? null;

          return {
            id: wi.fields["System.Id"],
            title: wi.fields["System.Title"],
            type: wi.fields["System.WorkItemType"],
            state: wi.fields["System.State"],
            assignee,
          };
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // list_saved_queries — Requirement 10.2
  server.tool(
    "list_saved_queries",
    "List all saved WIQL queries for an Azure DevOps project, returning id, name, path and queryType for each query.",
    {
      project: z.string().describe("Project name or ID"),
    },
    async ({ project }) => {
      try {
        const response = await azureClient.get<QueryTreeNode>(
          `/${encodeSegment(project)}/_apis/wit/queries`,
          { params: { $depth: 2 } }
        );

        // The root node itself may be a folder; collect its children
        const rootChildren = response.data.children ?? [];
        const queries = flattenQueryTree(rootChildren);

        return { content: [{ type: "text" as const, text: JSON.stringify(queries) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );
}
