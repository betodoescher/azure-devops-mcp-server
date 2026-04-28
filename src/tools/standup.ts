import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { azureClient } from "../azureClient.js";
import type { IdentityRef, WorkItem, WiqlQueryResult } from "../types/azure.js";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface StandupItem {
  id: number;
  title: string;
}

interface AssigneeGroup {
  completed: StandupItem[];
  inProgress: StandupItem[];
  blocked: StandupItem[];
}

interface StandupData {
  byAssignee: Record<string, AssigneeGroup>;
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

/** Returns the date of the last business day (skips weekends). */
function lastBusinessDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  do {
    d.setDate(d.getDate() - 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

/** Resolves the display name from a System.AssignedTo field value. */
function resolveAssignee(value: IdentityRef | string | undefined): string {
  if (!value) return "Unassigned";
  if (typeof value === "string") return value || "Unassigned";
  return value.displayName || value.uniqueName || "Unassigned";
}

/** Runs a WIQL query and returns the matching work item ids. */
async function runWiql(project: string, wiql: string): Promise<number[]> {
  const response = await azureClient.post<WiqlQueryResult>(
    `/${encodeURIComponent(project)}/_apis/wit/wiql`,
    { query: wiql }
  );
  return (response.data.workItems ?? []).map((ref) => ref.id);
}

/** Fetches work item details for a list of ids (batched to avoid URL limits). */
async function fetchWorkItemDetails(ids: number[]): Promise<WorkItem[]> {
  if (ids.length === 0) return [];

  const BATCH = 200;
  const results: WorkItem[] = [];

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const response = await azureClient.get<{ value: WorkItem[] }>(
      `/_apis/wit/workitems`,
      {
        params: {
          ids: batch.join(","),
          fields: "System.Id,System.Title,System.AssignedTo",
        },
      }
    );
    results.push(...(response.data.value ?? []));
  }

  return results;
}

/**
 * Core logic shared by both tools.
 * Runs three WIQL queries and groups results by assignee.
 */
async function fetchStandupData(project: string): Promise<StandupData> {
  const lastBizDay = lastBusinessDay();
  const lastBusinessDayISO = lastBizDay.toISOString();

  // Query a: Done since last business day
  const doneWiql = `SELECT [System.Id],[System.Title],[System.AssignedTo] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.State] IN ('Done','Closed','Resolved') AND [System.ChangedDate] >= '${lastBusinessDayISO}'`;

  // Query b: In Progress / To Do
  const inProgressWiql = `SELECT [System.Id],[System.Title],[System.AssignedTo] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.State] IN ('Active','In Progress','To Do','Doing')`;

  // Query c: Blocked
  const blockedWiql = `SELECT [System.Id],[System.Title],[System.AssignedTo] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND ([System.State] = 'Blocked' OR [System.Tags] CONTAINS 'impedimento')`;

  const [doneIds, inProgressIds, blockedIds] = await Promise.all([
    runWiql(project, doneWiql),
    runWiql(project, inProgressWiql),
    runWiql(project, blockedWiql),
  ]);

  const [doneItems, inProgressItems, blockedItems] = await Promise.all([
    fetchWorkItemDetails(doneIds),
    fetchWorkItemDetails(inProgressIds),
    fetchWorkItemDetails(blockedIds),
  ]);

  const byAssignee: Record<string, AssigneeGroup> = {};

  function ensureAssignee(name: string): AssigneeGroup {
    if (!byAssignee[name]) {
      byAssignee[name] = { completed: [], inProgress: [], blocked: [] };
    }
    return byAssignee[name];
  }

  for (const item of doneItems) {
    const assignee = resolveAssignee(item.fields["System.AssignedTo"]);
    ensureAssignee(assignee).completed.push({
      id: item.id,
      title: item.fields["System.Title"],
    });
  }

  for (const item of inProgressItems) {
    const assignee = resolveAssignee(item.fields["System.AssignedTo"]);
    ensureAssignee(assignee).inProgress.push({
      id: item.id,
      title: item.fields["System.Title"],
    });
  }

  for (const item of blockedItems) {
    const assignee = resolveAssignee(item.fields["System.AssignedTo"]);
    ensureAssignee(assignee).blocked.push({
      id: item.id,
      title: item.fields["System.Title"],
    });
  }

  return { byAssignee };
}

/** Formats standup data as a Markdown agenda string. */
function formatMarkdownAgenda(data: StandupData): string {
  const today = new Date().toISOString().split("T")[0];
  const lines: string[] = [`# Daily Standup - ${today}`, ""];

  const assignees = Object.keys(data.byAssignee).sort();

  for (const assignee of assignees) {
    const group = data.byAssignee[assignee];

    lines.push(`## ${assignee}`);

    lines.push("### ✅ Completed");
    if (group.completed.length > 0) {
      for (const item of group.completed) {
        lines.push(`- [${item.id}] ${item.title}`);
      }
    } else {
      lines.push("- _(none)_");
    }
    lines.push("");

    lines.push("### 🔄 In Progress");
    if (group.inProgress.length > 0) {
      for (const item of group.inProgress) {
        lines.push(`- [${item.id}] ${item.title}`);
      }
    } else {
      lines.push("- _(none)_");
    }
    lines.push("");

    lines.push("### 🚫 Blocked");
    if (group.blocked.length > 0) {
      for (const item of group.blocked) {
        lines.push(`- [${item.id}] ${item.title}`);
      }
    } else {
      lines.push("- _(none)_");
    }
    lines.push("");

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // get_standup_summary — Requirement 15.1
  // -------------------------------------------------------------------------
  server.tool(
    "get_standup_summary",
    "Returns a structured standup summary grouped by assignee: work items moved to Done since the last business day, " +
      "items currently In Progress or To Do, and items that are Blocked or tagged 'impedimento'.",
    {
      project: z.string().describe("Project name or id"),
      team: z.string().describe("Team name or id"),
    },
    async ({ project }) => {
      try {
        const data = await fetchStandupData(project);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // export_standup_agenda — Requirement 15.2
  // -------------------------------------------------------------------------
  server.tool(
    "export_standup_agenda",
    "Returns a Markdown-formatted daily standup agenda ready to paste into Slack or Microsoft Teams. " +
      "Organized by team member with sections for completed, in-progress and blocked items.",
    {
      project: z.string().describe("Project name or id"),
      team: z.string().describe("Team name or id"),
    },
    async ({ project }) => {
      try {
        const data = await fetchStandupData(project);
        const agenda = formatMarkdownAgenda(data);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ agenda }),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );
}
