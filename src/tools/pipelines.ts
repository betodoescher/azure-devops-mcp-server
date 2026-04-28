import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { azureClient } from "../azureClient.js";
import type {
  ApiListResponse,
  Pipeline,
  PipelineRun,
} from "../types/azure.js";

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
        text: JSON.stringify({
          error: error.message,
          statusCode: error.statusCode ?? 500,
        }),
      },
    ],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // list_pipelines — Requirement 7.1
  server.tool(
    "list_pipelines",
    "List all pipeline definitions in a project, returning id, name, folder and revision for each pipeline.",
    {
      project: z.string().describe("Project name or ID"),
    },
    async ({ project }) => {
      try {
        const response = await azureClient.get<ApiListResponse<Pipeline>>(
          `/${encodeSegment(project)}/_apis/pipelines`
        );
        const pipelines = response.data.value.map((p) => ({
          id: p.id,
          name: p.name,
          folder: p.folder,
          revision: p.revision,
        }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(pipelines) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // get_pipeline — Requirement 7.2
  server.tool(
    "get_pipeline",
    "Get full details of a specific pipeline including configuration, triggers and repository reference.",
    {
      project: z.string().describe("Project name or ID"),
      pipelineId: z.number().describe("Pipeline ID"),
    },
    async ({ project, pipelineId }) => {
      try {
        const response = await azureClient.get<Pipeline>(
          `/${encodeSegment(project)}/_apis/pipelines/${pipelineId}`
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(response.data) },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // run_pipeline — Requirement 7.3
  server.tool(
    "run_pipeline",
    "Trigger a new pipeline run. Optionally specify a branch and/or variables. Returns the run id and status URL.",
    {
      project: z.string().describe("Project name or ID"),
      pipelineId: z.number().describe("Pipeline ID"),
      branch: z
        .string()
        .optional()
        .describe("Branch name to run (e.g. main). Omit to use the default branch."),
      variables: z
        .record(z.string())
        .optional()
        .describe("Key-value map of pipeline variables to override"),
    },
    async ({ project, pipelineId, branch, variables }) => {
      try {
        const body: {
          resources: {
            repositories: {
              self: { refName?: string };
            };
          };
          variables?: Record<string, { value: string }>;
        } = {
          resources: {
            repositories: {
              self: {
                refName: branch ? `refs/heads/${branch}` : undefined,
              },
            },
          },
        };

        if (variables) {
          body.variables = Object.fromEntries(
            Object.entries(variables).map(([k, v]) => [k, { value: v }])
          );
        }

        const response = await azureClient.post<PipelineRun>(
          `/${encodeSegment(project)}/_apis/pipelines/${pipelineId}/runs`,
          body
        );

        const run = response.data;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: run.id, url: run.url }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // get_pipeline_runs — Requirement 7.4
  server.tool(
    "get_pipeline_runs",
    "Get the run history for a pipeline, returning id, state, result, createdDate, finishedDate and trigger info for each run.",
    {
      project: z.string().describe("Project name or ID"),
      pipelineId: z.number().describe("Pipeline ID"),
    },
    async ({ project, pipelineId }) => {
      try {
        const response = await azureClient.get<ApiListResponse<PipelineRun>>(
          `/${encodeSegment(project)}/_apis/pipelines/${pipelineId}/runs`
        );
        const runs = response.data.value.map((r) => ({
          id: r.id,
          name: r.name,
          state: r.state,
          result: r.result,
          createdDate: r.createdDate,
          finishedDate: r.finishedDate,
          resources: r.resources,
          url: r.url,
        }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(runs) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // get_pipeline_run_details — Requirement 7.5
  server.tool(
    "get_pipeline_run_details",
    "Get detailed information about a specific pipeline run, including stages, jobs, steps status and log URLs.",
    {
      project: z.string().describe("Project name or ID"),
      pipelineId: z.number().describe("Pipeline ID"),
      runId: z.number().describe("Run ID"),
    },
    async ({ project, pipelineId, runId }) => {
      try {
        const response = await azureClient.get<PipelineRun>(
          `/${encodeSegment(project)}/_apis/pipelines/${pipelineId}/runs/${runId}`,
          {
            params: {
              $expand: "stages,jobs,steps",
            },
          }
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(response.data) },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );
}
