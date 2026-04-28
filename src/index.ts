import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerTools as registerProjectsTools } from "./tools/projects.js";
import { registerTools as registerWorkItemsTools } from "./tools/workItems.js";
import { registerTools as registerBoardsTools } from "./tools/boards.js";
import { registerTools as registerPipelinesTools } from "./tools/pipelines.js";
import { registerTools as registerReposTools } from "./tools/repos.js";
import { registerTools as registerTeamsTools } from "./tools/teams.js";
import { registerTools as registerQueriesTools } from "./tools/queries.js";
import { registerTools as registerAnalyticsTools } from "./tools/analytics.js";
import { registerTools as registerReportsTools } from "./tools/reports.js";
import { registerTools as registerBulkTools } from "./tools/bulk.js";
import { registerTools as registerTemplatesTools } from "./tools/templates.js";
import { registerTools as registerStandupTools } from "./tools/standup.js";
import { registerTools as registerAuditTools } from "./tools/audit.js";
import { registerTools as registerTestPlansTools } from "./tools/testPlans.js";

async function main(): Promise<void> {
  const server = new McpServer({
    name: "azure-devops-mcp",
    version: "1.0.0",
  });

  // Register tools from all 13 modules before accepting connections
  registerProjectsTools(server);
  registerWorkItemsTools(server);
  registerBoardsTools(server);
  registerPipelinesTools(server);
  registerReposTools(server);
  registerTeamsTools(server);
  registerQueriesTools(server);
  registerAnalyticsTools(server);
  registerReportsTools(server);
  registerBulkTools(server);
  registerTemplatesTools(server);
  registerStandupTools(server);
  registerAuditTools(server);
  registerTestPlansTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[azure-devops-mcp] Fatal error: ${message}`);
  process.exit(1);
});
