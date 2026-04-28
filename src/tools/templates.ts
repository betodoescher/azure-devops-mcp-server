import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { azureClient } from "../azureClient.js";
import { config } from "../config.js";
import type { ApiListResponse, Sprint, WorkItem } from "../types/azure.js";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface JsonPatchOperation {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
}

interface WorkItemTemplate {
  id: string;
  name: string;
  workItemTypeName: string;
  fields: Record<string, unknown>;
}

interface SprintWorkItemsResponse {
  workItemRelations: Array<{
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

async function createWorkItem(
  project: string,
  type: string,
  patches: JsonPatchOperation[]
): Promise<WorkItem> {
  const response = await azureClient.post<WorkItem>(
    `/${encodeURIComponent(project)}/_apis/wit/workitems/$${encodeURIComponent(type)}`,
    patches,
    { headers: { "Content-Type": "application/json-patch+json" } }
  );
  return response.data;
}

function parentRelationPatch(parentId: number): JsonPatchOperation {
  return {
    op: "add",
    path: "/relations/-",
    value: {
      rel: "System.LinkTypes.Hierarchy-Reverse",
      url: `${config.AZURE_DEVOPS_ORG}/_apis/wit/workitems/${parentId}`,
      attributes: {},
    },
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // create_sprint_from_template — Requirement 14.1
  // -------------------------------------------------------------------------
  server.tool(
    "create_sprint_from_template",
    "Create a sprint (iteration) from a template definition containing name, start date, finish date and optional goal. " +
      "Returns the created sprint id and URL.",
    {
      project: z.string().describe("Project name or id"),
      team: z.string().describe("Team name or id"),
      name: z.string().describe("Sprint name"),
      startDate: z.string().describe("Sprint start date in ISO 8601 format"),
      finishDate: z.string().describe("Sprint finish date in ISO 8601 format"),
      goal: z.string().optional().describe("Optional sprint goal"),
    },
    async ({ project, team, name, startDate, finishDate, goal }) => {
      try {
        const body: {
          name: string;
          attributes: { startDate: string; finishDate: string };
          description?: string;
        } = {
          name,
          attributes: { startDate, finishDate },
        };

        if (goal !== undefined) {
          body.description = goal;
        }

        const response = await azureClient.post<Sprint>(
          `/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations`,
          body
        );

        const sprint = response.data;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: sprint.id, url: sprint.url }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // scaffold_epic_hierarchy — Requirement 14.2
  // -------------------------------------------------------------------------
  server.tool(
    "scaffold_epic_hierarchy",
    "Create an Epic with linked Features, each with linked User Stories, using parent-child relations. " +
      "Returns the ids of all created work items.",
    {
      project: z.string().describe("Project name or id"),
      epicTitle: z.string().describe("Title of the Epic to create"),
      features: z
        .array(
          z.object({
            title: z.string().describe("Feature title"),
            stories: z.array(z.string()).describe("User Story titles for this feature"),
          })
        )
        .describe("Features to create under the Epic, each with their User Stories"),
    },
    async ({ project, epicTitle, features }) => {
      try {
        // Create Epic
        const epic = await createWorkItem(project, "Epic", [
          { op: "add", path: "/fields/System.Title", value: epicTitle },
        ]);
        const epicId = epic.id;

        const featureResults: Array<{
          featureId: number;
          title: string;
          stories: Array<{ storyId: number; title: string }>;
        }> = [];

        for (const featureDef of features) {
          // Create Feature linked to Epic
          const feature = await createWorkItem(project, "Feature", [
            { op: "add", path: "/fields/System.Title", value: featureDef.title },
            parentRelationPatch(epicId),
          ]);
          const featureId = feature.id;

          const storyResults: Array<{ storyId: number; title: string }> = [];

          for (const storyTitle of featureDef.stories) {
            // Create User Story linked to Feature
            const story = await createWorkItem(project, "User Story", [
              { op: "add", path: "/fields/System.Title", value: storyTitle },
              parentRelationPatch(featureId),
            ]);
            storyResults.push({ storyId: story.id, title: storyTitle });
          }

          featureResults.push({
            featureId,
            title: featureDef.title,
            stories: storyResults,
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ epicId, features: featureResults }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // duplicate_sprint_structure — Requirement 14.3
  // -------------------------------------------------------------------------
  server.tool(
    "duplicate_sprint_structure",
    "Duplicate the work item structure of a source sprint into a target sprint. " +
      "Creates new work items with the same type and title but does NOT copy assignee, state or story points.",
    {
      project: z.string().describe("Project name or id"),
      team: z.string().describe("Team name or id"),
      sourceIterationId: z.string().describe("Source sprint iteration id"),
      targetIterationPath: z.string().describe("Target sprint iteration path for new items"),
    },
    async ({ project, team, sourceIterationId, targetIterationPath }) => {
      try {
        // Fetch work items in the source sprint
        const sprintItemsResponse = await azureClient.get<SprintWorkItemsResponse>(
          `/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations/${encodeURIComponent(sourceIterationId)}/workitems`
        );

        const relations = sprintItemsResponse.data.workItemRelations ?? [];
        if (relations.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ created: [] }),
              },
            ],
          };
        }

        const sourceIds = relations.map((r) => r.target.id);

        // Fetch type and title for each source item
        const detailsResponse = await azureClient.get<{ value: WorkItem[] }>(
          `/_apis/wit/workitems`,
          {
            params: {
              ids: sourceIds.join(","),
              fields: "System.WorkItemType,System.Title",
            },
          }
        );

        const sourceItems = detailsResponse.data.value ?? [];

        const created: Array<{
          originalId: number;
          newId: number;
          title: string;
          type: string;
        }> = [];

        for (const item of sourceItems) {
          const type = item.fields["System.WorkItemType"] as string;
          const title = item.fields["System.Title"] as string;

          const newItem = await createWorkItem(project, type, [
            { op: "add", path: "/fields/System.Title", value: title },
            { op: "add", path: "/fields/System.IterationPath", value: targetIterationPath },
          ]);

          created.push({
            originalId: item.id,
            newId: newItem.id,
            title,
            type,
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ created }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // list_work_item_templates — Requirement 14.4
  // -------------------------------------------------------------------------
  server.tool(
    "list_work_item_templates",
    "List all work item templates available for a team. " +
      "Returns template id, name, work item type and pre-filled fields.",
    {
      project: z.string().describe("Project name or id"),
      team: z.string().describe("Team name or id"),
    },
    async ({ project, team }) => {
      try {
        const response = await azureClient.get<ApiListResponse<WorkItemTemplate>>(
          `/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/wit/templates`
        );

        const templates = (response.data.value ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          workItemTypeName: t.workItemTypeName,
          fields: t.fields,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ count: templates.length, templates }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // create_from_work_item_template — Requirement 14.5
  // -------------------------------------------------------------------------
  server.tool(
    "create_from_work_item_template",
    "Create a work item from a saved team template, with optional field overrides. " +
      "Returns the created work item id and URL.",
    {
      project: z.string().describe("Project name or id"),
      team: z.string().describe("Team name or id"),
      templateId: z.string().describe("Template id"),
      overrides: z
        .record(z.unknown())
        .optional()
        .describe("Optional field overrides to apply on top of the template fields"),
    },
    async ({ project, team, templateId, overrides }) => {
      try {
        // Fetch the template to get its fields and work item type
        const templateResponse = await azureClient.get<WorkItemTemplate>(
          `/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/wit/templates/${encodeURIComponent(templateId)}`
        );

        const template = templateResponse.data;
        const mergedFields: Record<string, unknown> = {
          ...template.fields,
          ...(overrides ?? {}),
        };

        const patches: JsonPatchOperation[] = Object.entries(mergedFields).map(
          ([field, value]) => ({
            op: "add" as const,
            path: `/fields/${field}`,
            value,
          })
        );

        const newItem = await createWorkItem(
          project,
          template.workItemTypeName,
          patches
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: newItem.id, url: newItem.url }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );
}
