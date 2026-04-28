import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { azureClient } from "../azureClient.js";
import type { ApiListResponse, Project } from "../types/azure.js";

export function registerTools(server: McpServer): void {
  // list_projects — Requirement 4.1
  server.tool(
    "list_projects",
    "List all projects in the Azure DevOps organization, returning id, name, description, state and visibility for each project.",
    {},
    async () => {
      try {
        const response = await azureClient.get<ApiListResponse<Project>>("/_apis/projects");
        const projects = response.data.value.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          state: p.state,
          visibility: p.visibility,
        }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(projects) }],
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

  // get_project — Requirement 4.2
  server.tool(
    "get_project",
    "Get full details of a specific Azure DevOps project by id or name, including capabilities and process template.",
    {
      projectId: z.string().describe("Project ID or name"),
    },
    async ({ projectId }) => {
      try {
        const response = await azureClient.get<Project>(
          `/_apis/projects/${encodeURIComponent(projectId)}`,
          { params: { $includeCapabilities: true } }
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
}
