# Azure DevOps MCP Server

A full-featured [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for Azure DevOps integration. Lets AI assistants like **Claude Desktop** and **Kiro** interact with projects, work items, pipelines, repositories, analytics and more — directly via natural language.

## Features

- **~60 tools** across 13 categories
- PAT-based authentication via Basic Auth
- Automatic retry with exponential backoff (429 and 5xx)
- 30s timeout on all API calls
- Analytics metrics calculated server-side (cycle time, lead time, velocity, burndown)
- Bulk operations for work items
- Proactive alerts (stale PRs, failing pipelines, blocked items)
- Release notes generation in Markdown or HTML
- Daily standup agenda ready to paste into Slack/Teams

## Prerequisites

- Node.js 20+
- An Azure DevOps organization
- A Personal Access Token (PAT) with the required permissions

## Installation

```bash
npm install
npm run build
```

## Configuration

Copy the example file and fill in your details:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required
AZURE_DEVOPS_PAT=your_token_here
AZURE_DEVOPS_ORG=https://dev.azure.com/your-organization

# Optional (defaults provided)
AZURE_DEVOPS_API_VERSION=7.1
STALE_PR_DAYS=3
BLOCKED_ITEM_DAYS=2
FAILING_PIPELINE_THRESHOLD=3
```

### Generating a PAT

1. Go to `https://dev.azure.com/{your-org}/_usersSettings/tokens`
2. Click **New Token**
3. Set the minimum required permissions:

| Scope | Permission |
|-------|------------|
| Work Items | Read & Write |
| Code | Read |
| Build | Read & Execute |
| Project and Team | Read |
| Analytics | Read (for metrics) |

## Adding to an MCP Client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "AZURE_DEVOPS_PAT": "your_token",
        "AZURE_DEVOPS_ORG": "https://dev.azure.com/your-organization"
      }
    }
  }
}
```

### Kiro

Edit `.kiro/settings/mcp.json` in your workspace:

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "AZURE_DEVOPS_PAT": "your_token",
        "AZURE_DEVOPS_ORG": "https://dev.azure.com/your-organization"
      }
    }
  }
}
```

## Available Scripts

```bash
npm run build    # Compile TypeScript with tsup
npm run start    # Run the compiled server
npm run lint     # Lint with ESLint
npm run format   # Format with Prettier
```

## Development

Build and run manually:

```bash
npm run build && npm run start
```

The server communicates via **stdio** — it does not expose any HTTP port.

## Security

- The PAT **never** appears in logs, errors or any output
- `.gitignore` excludes `.env` and `*.env` automatically
- WIQL query inputs are sanitized to prevent parameter injection

## Stack

- **Runtime**: Node.js 20+ / TypeScript strict
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **HTTP**: `axios` + `axios-retry`
- **Validation**: `zod`
- **Build**: `tsup`

## Tools

See [TOOLS.md](./TOOLS.md) for the full list of available tools by category.
