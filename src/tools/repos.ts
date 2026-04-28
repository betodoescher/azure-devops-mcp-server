import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { azureClient } from "../azureClient.js";
import type {
  ApiListResponse,
  Repository,
  PullRequest,
  Commit,
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
  // list_repositories — Requirement 8.1
  server.tool(
    "list_repositories",
    "List all Git repositories in a project, returning id, name, default branch and remote URL for each.",
    {
      project: z.string().describe("Project name or ID"),
    },
    async ({ project }) => {
      try {
        const response = await azureClient.get<ApiListResponse<Repository>>(
          `/${encodeSegment(project)}/_apis/git/repositories`
        );
        const repos = response.data.value.map((r) => ({
          id: r.id,
          name: r.name,
          defaultBranch: r.defaultBranch,
          remoteUrl: r.remoteUrl,
        }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(repos) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // get_repository — Requirement 8.2
  server.tool(
    "get_repository",
    "Get full details of a specific repository including size, branch statistics and links.",
    {
      project: z.string().describe("Project name or ID"),
      repositoryId: z.string().describe("Repository ID or name"),
    },
    async ({ project, repositoryId }) => {
      try {
        const response = await azureClient.get<Repository>(
          `/${encodeSegment(project)}/_apis/git/repositories/${encodeSegment(repositoryId)}`
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

  // list_pull_requests — Requirement 8.3
  server.tool(
    "list_pull_requests",
    "List pull requests in a repository. Supports optional filters: status, author and source branch.",
    {
      project: z.string().describe("Project name or ID"),
      repositoryId: z.string().describe("Repository ID or name"),
      status: z
        .enum(["active", "completed", "abandoned"])
        .optional()
        .describe("Filter by PR status"),
      author: z
        .string()
        .optional()
        .describe("Filter by creator identity ID or display name"),
      sourceBranch: z
        .string()
        .optional()
        .describe("Filter by source branch name (without refs/heads/ prefix)"),
    },
    async ({ project, repositoryId, status, author, sourceBranch }) => {
      try {
        const params: Record<string, string> = {};
        if (status) params["searchCriteria.status"] = status;
        if (author) params["searchCriteria.creatorId"] = author;
        if (sourceBranch)
          params["searchCriteria.sourceRefName"] = `refs/heads/${sourceBranch}`;

        const response = await azureClient.get<ApiListResponse<PullRequest>>(
          `/${encodeSegment(project)}/_apis/git/repositories/${encodeSegment(repositoryId)}/pullrequests`,
          { params }
        );
        const prs = response.data.value.map((pr) => ({
          pullRequestId: pr.pullRequestId,
          title: pr.title,
          status: pr.status,
          createdBy: pr.createdBy,
          creationDate: pr.creationDate,
          sourceRefName: pr.sourceRefName,
          targetRefName: pr.targetRefName,
        }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(prs) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // get_pull_request — Requirement 8.4
  server.tool(
    "get_pull_request",
    "Get full details of a specific pull request including title, description, reviewers, status, merge status and linked work items.",
    {
      project: z.string().describe("Project name or ID"),
      repositoryId: z.string().describe("Repository ID or name"),
      pullRequestId: z.number().describe("Pull request ID"),
    },
    async ({ project, repositoryId, pullRequestId }) => {
      try {
        const response = await azureClient.get<PullRequest>(
          `/${encodeSegment(project)}/_apis/git/repositories/${encodeSegment(repositoryId)}/pullrequests/${pullRequestId}`
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

  // create_pull_request — Requirement 8.5
  server.tool(
    "create_pull_request",
    "Create a new pull request. Returns the PR id and URL. Supports optional description, reviewers and linked work item IDs.",
    {
      project: z.string().describe("Project name or ID"),
      repositoryId: z.string().describe("Repository ID or name"),
      sourceRefName: z
        .string()
        .describe("Source branch name (without refs/heads/ prefix)"),
      targetRefName: z
        .string()
        .describe("Target branch name (without refs/heads/ prefix)"),
      title: z.string().describe("Pull request title"),
      description: z.string().optional().describe("Pull request description"),
      reviewers: z
        .array(z.string())
        .optional()
        .describe("List of reviewer identity IDs"),
      workItemIds: z
        .array(z.number())
        .optional()
        .describe("List of work item IDs to link"),
    },
    async ({
      project,
      repositoryId,
      sourceRefName,
      targetRefName,
      title,
      description,
      reviewers,
      workItemIds,
    }) => {
      try {
        const body: {
          title: string;
          description?: string;
          sourceRefName: string;
          targetRefName: string;
          reviewers?: { id: string }[];
          workItemRefs?: { id: string }[];
        } = {
          title,
          description,
          sourceRefName: `refs/heads/${sourceRefName}`,
          targetRefName: `refs/heads/${targetRefName}`,
        };

        if (reviewers) {
          body.reviewers = reviewers.map((id) => ({ id }));
        }
        if (workItemIds) {
          body.workItemRefs = workItemIds.map((id) => ({ id: String(id) }));
        }

        const response = await azureClient.post<PullRequest>(
          `/${encodeSegment(project)}/_apis/git/repositories/${encodeSegment(repositoryId)}/pullrequests`,
          body
        );
        const pr = response.data;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: pr.pullRequestId, url: pr.url }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // list_commits — Requirement 8.6
  server.tool(
    "list_commits",
    "List commits in a repository. Supports optional filters: author, fromDate and toDate (ISO 8601 format).",
    {
      project: z.string().describe("Project name or ID"),
      repositoryId: z.string().describe("Repository ID or name"),
      author: z.string().optional().describe("Filter by author name or email"),
      fromDate: z
        .string()
        .optional()
        .describe("Start date filter in ISO 8601 format"),
      toDate: z
        .string()
        .optional()
        .describe("End date filter in ISO 8601 format"),
    },
    async ({ project, repositoryId, author, fromDate, toDate }) => {
      try {
        const params: Record<string, string> = {};
        if (author) params["searchCriteria.author"] = author;
        if (fromDate) params["searchCriteria.fromDate"] = fromDate;
        if (toDate) params["searchCriteria.toDate"] = toDate;

        const response = await azureClient.get<ApiListResponse<Commit>>(
          `/${encodeSegment(project)}/_apis/git/repositories/${encodeSegment(repositoryId)}/commits`,
          { params }
        );
        const commits = response.data.value.map((c) => ({
          commitId: c.commitId,
          author: c.author,
          committer: c.committer,
          comment: c.comment,
          url: c.url,
        }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(commits) }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // get_file_content — Requirement 8.7
  server.tool(
    "get_file_content",
    "Get the raw content of a file from a repository. Optionally specify a branch or commit ID to retrieve a specific version.",
    {
      project: z.string().describe("Project name or ID"),
      repositoryId: z.string().describe("Repository ID or name"),
      path: z.string().describe("File path within the repository (e.g. /src/index.ts)"),
      branch: z
        .string()
        .optional()
        .describe("Branch name to retrieve the file from"),
      commitId: z
        .string()
        .optional()
        .describe("Commit ID to retrieve the file from"),
    },
    async ({ project, repositoryId, path, branch, commitId }) => {
      try {
        const params: Record<string, string> = {
          path,
          $format: "text",
        };

        if (commitId) {
          params["versionDescriptor.version"] = commitId;
          params["versionDescriptor.versionType"] = "commit";
        } else if (branch) {
          params["versionDescriptor.version"] = branch;
          params["versionDescriptor.versionType"] = "branch";
        }

        const response = await azureClient.get<string>(
          `/${encodeSegment(project)}/_apis/git/repositories/${encodeSegment(repositoryId)}/items`,
          { params }
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
        return errorResponse(err);
      }
    }
  );
}
