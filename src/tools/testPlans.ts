import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { azureClient } from "../azureClient.js";
import type {
  ApiListResponse,
  TestPlan,
  TestSuite,
  TestCase,
  TestPoint,
  TestRun,
  TestResult,
} from "../types/azure.js";

function enc(value: string): string {
  return encodeURIComponent(value);
}

function errorResponse(err: unknown) {
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
    isError: true as const,
  };
}

export function registerTools(server: McpServer): void {
  // ── Test Plans ──────────────────────────────────────────────────────

  server.tool(
    "list_test_plans",
    "List all test plans in a project.",
    {
      project: z.string().describe("Project name or ID"),
    },
    async ({ project }) => {
      try {
        const res = await azureClient.get<ApiListResponse<TestPlan>>(
          `/${enc(project)}/_apis/testplan/plans`
        );
        const plans = res.data.value.map((p) => ({
          id: p.id,
          name: p.name,
          state: p.state,
          startDate: p.startDate,
          endDate: p.endDate,
          iteration: p.iteration,
          areaPath: p.areaPath,
          rootSuiteId: p.rootSuite?.id,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(plans) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  server.tool(
    "get_test_plan",
    "Get full details of a specific test plan.",
    {
      project: z.string().describe("Project name or ID"),
      planId: z.number().describe("Test plan ID"),
    },
    async ({ project, planId }) => {
      try {
        const res = await azureClient.get<TestPlan>(
          `/${enc(project)}/_apis/testplan/plans/${planId}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // ── Test Suites ─────────────────────────────────────────────────────

  server.tool(
    "list_test_suites",
    "List all test suites in a test plan.",
    {
      project: z.string().describe("Project name or ID"),
      planId: z.number().describe("Test plan ID"),
    },
    async ({ project, planId }) => {
      try {
        const res = await azureClient.get<ApiListResponse<TestSuite>>(
          `/${enc(project)}/_apis/testplan/plans/${planId}/suites`
        );
        const suites = res.data.value.map((s) => ({
          id: s.id,
          name: s.name,
          suiteType: s.suiteType,
          parentSuiteId: s.parentSuite?.id,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(suites) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  server.tool(
    "get_test_suite",
    "Get details of a specific test suite.",
    {
      project: z.string().describe("Project name or ID"),
      planId: z.number().describe("Test plan ID"),
      suiteId: z.number().describe("Test suite ID"),
    },
    async ({ project, planId, suiteId }) => {
      try {
        const res = await azureClient.get<TestSuite>(
          `/${enc(project)}/_apis/testplan/plans/${planId}/suites/${suiteId}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // ── Test Cases (within a suite) ─────────────────────────────────────

  server.tool(
    "list_test_cases",
    "List test cases in a specific test suite.",
    {
      project: z.string().describe("Project name or ID"),
      planId: z.number().describe("Test plan ID"),
      suiteId: z.number().describe("Test suite ID"),
    },
    async ({ project, planId, suiteId }) => {
      try {
        const res = await azureClient.get<ApiListResponse<TestCase>>(
          `/${enc(project)}/_apis/testplan/plans/${planId}/suites/${suiteId}/testcase`
        );
        const cases = res.data.value.map((tc) => ({
          id: tc.workItem.id,
          name: tc.workItem.name,
          pointAssignments: tc.pointAssignments?.map((pa) => ({
            configurationId: pa.configurationId,
            configurationName: pa.configurationName,
            tester: pa.tester?.displayName,
          })),
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(cases) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // ── Test Points ─────────────────────────────────────────────────────

  server.tool(
    "list_test_points",
    "List test points in a suite. Test points represent the combination of test case + configuration + tester.",
    {
      project: z.string().describe("Project name or ID"),
      planId: z.number().describe("Test plan ID"),
      suiteId: z.number().describe("Test suite ID"),
    },
    async ({ project, planId, suiteId }) => {
      try {
        const res = await azureClient.get<ApiListResponse<TestPoint>>(
          `/${enc(project)}/_apis/testplan/plans/${planId}/suites/${suiteId}/testpoint`
        );
        const points = res.data.value.map((tp) => ({
          id: tp.id,
          testCaseId: tp.testCaseReference?.id,
          testCaseName: tp.testCaseReference?.name,
          configuration: tp.configuration?.name,
          outcome: tp.outcome,
          state: tp.state,
          tester: tp.tester?.displayName,
          assignedTo: tp.assignedTo?.displayName,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(points) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // ── Test Runs ───────────────────────────────────────────────────────

  server.tool(
    "list_test_runs",
    "List test runs in a project. Optionally filter by plan ID.",
    {
      project: z.string().describe("Project name or ID"),
      planId: z.number().optional().describe("Filter by test plan ID"),
      top: z.number().optional().describe("Max results to return (default 25)"),
    },
    async ({ project, planId, top }) => {
      try {
        const params: Record<string, string | number> = {};
        if (planId) params.planId = planId;
        if (top) params["$top"] = top;

        const res = await azureClient.get<ApiListResponse<TestRun>>(
          `/${enc(project)}/_apis/test/runs`,
          { params }
        );
        const runs = res.data.value.map((r) => ({
          id: r.id,
          name: r.name,
          state: r.state,
          totalTests: r.totalTests,
          passedTests: r.passedTests,
          startedDate: r.startedDate,
          completedDate: r.completedDate,
          webAccessUrl: r.webAccessUrl,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(runs) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  server.tool(
    "get_test_run",
    "Get details of a specific test run.",
    {
      project: z.string().describe("Project name or ID"),
      runId: z.number().describe("Test run ID"),
    },
    async ({ project, runId }) => {
      try {
        const res = await azureClient.get<TestRun>(
          `/${enc(project)}/_apis/test/runs/${runId}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  // ── Test Results ────────────────────────────────────────────────────

  server.tool(
    "list_test_results",
    "List test results for a specific test run.",
    {
      project: z.string().describe("Project name or ID"),
      runId: z.number().describe("Test run ID"),
      outcomes: z
        .array(z.enum(["Passed", "Failed", "NotExecuted", "Blocked", "Inconclusive"]))
        .optional()
        .describe("Filter by outcome(s)"),
      top: z.number().optional().describe("Max results to return"),
    },
    async ({ project, runId, outcomes, top }) => {
      try {
        const params: Record<string, string | number> = {};
        if (outcomes?.length) params.outcomes = outcomes.join(",");
        if (top) params["$top"] = top;

        const res = await azureClient.get<ApiListResponse<TestResult>>(
          `/${enc(project)}/_apis/test/runs/${runId}/results`,
          { params }
        );
        const results = res.data.value.map((r) => ({
          id: r.id,
          testCaseTitle: r.testCaseTitle,
          outcome: r.outcome,
          state: r.state,
          durationInMs: r.durationInMs,
          errorMessage: r.errorMessage,
          runBy: r.runBy?.displayName,
          completedDate: r.completedDate,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  server.tool(
    "get_test_result",
    "Get full details of a specific test result including error message and stack trace.",
    {
      project: z.string().describe("Project name or ID"),
      runId: z.number().describe("Test run ID"),
      resultId: z.number().describe("Test result ID"),
    },
    async ({ project, runId, resultId }) => {
      try {
        const res = await azureClient.get<TestResult>(
          `/${enc(project)}/_apis/test/runs/${runId}/results/${resultId}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );
}
