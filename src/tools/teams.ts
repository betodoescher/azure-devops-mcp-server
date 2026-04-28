import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { azureClient } from "../azureClient.js";
import type { ApiListResponse, Team, TeamMember } from "../types/azure.js";

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
// Azure DevOps team member API shape
// The get_team_members endpoint returns objects with an `identity` property
// ---------------------------------------------------------------------------

interface TeamMemberEntry {
  identity: TeamMember;
  isTeamAdmin?: boolean;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // list_teams — Requirement 9.1
  server.tool(
    "list_teams",
    "List all teams for a given Azure DevOps project, returning id, name, description and memberCount for each team.",
    {
      project: z.string().describe("Project name or ID"),
    },
    async ({ project }) => {
      try {
        const response = await azureClient.get<ApiListResponse<Team>>(
          `/_apis/projects/${encodeSegment(project)}/teams`
        );
        const teams = response.data.value.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description ?? null,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(teams) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // get_team_members — Requirement 9.2
  server.tool(
    "get_team_members",
    "Get all members of a specific Azure DevOps team, returning displayName, uniqueName (email) and identity descriptor for each member.",
    {
      project: z.string().describe("Project name or ID"),
      teamId: z.string().describe("Team name or ID"),
    },
    async ({ project, teamId }) => {
      try {
        const response = await azureClient.get<ApiListResponse<TeamMemberEntry>>(
          `/_apis/projects/${encodeSegment(project)}/teams/${encodeSegment(teamId)}/members`
        );
        const members = response.data.value.map((entry) => ({
          id: entry.identity.id,
          displayName: entry.identity.displayName,
          uniqueName: entry.identity.uniqueName,
          descriptor: entry.identity.descriptor,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(members) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );
}
