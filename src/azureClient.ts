import axios, { AxiosError, AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import { config } from "./config.js";

// Basic Auth: empty username, PAT as password
const basicAuth = Buffer.from(`:${config.AZURE_DEVOPS_PAT}`).toString("base64");

const azureClient: AxiosInstance = axios.create({
  baseURL: config.AZURE_DEVOPS_ORG,
  timeout: 30_000,
  headers: {
    "Content-Type": "application/json",
    Authorization: `Basic ${basicAuth}`,
  },
});

// Inject api-version query param when absent
azureClient.interceptors.request.use((reqConfig) => {
  const params = reqConfig.params as Record<string, string> | undefined;
  if (!params?.["api-version"]) {
    reqConfig.params = {
      ...params,
      "api-version": config.AZURE_DEVOPS_API_VERSION,
    };
  }
  return reqConfig;
});

// Retry on 429 and 5xx with exponential backoff
axiosRetry(azureClient, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error: AxiosError) => {
    const status = error.response?.status;
    return status === 429 || (status !== undefined && status >= 500);
  },
});

// Structured request/response logging — never log the PAT
azureClient.interceptors.request.use((reqConfig) => {
  (reqConfig as typeof reqConfig & { metadata?: { startTime: number } }).metadata = {
    startTime: Date.now(),
  };
  return reqConfig;
});

azureClient.interceptors.response.use(
  (response) => {
    const meta = (
      response.config as typeof response.config & {
        metadata?: { startTime: number };
      }
    ).metadata;
    const duration = meta ? Date.now() - meta.startTime : -1;
    console.error(
      JSON.stringify({
        level: "info",
        method: response.config.method?.toUpperCase(),
        url: response.config.url,
        status: response.status,
        durationMs: duration,
      })
    );
    return response;
  },
  (error: AxiosError) => {
    const meta = (
      error.config as (typeof error.config & {
        metadata?: { startTime: number };
      }) | undefined
    )?.metadata;
    const duration = meta ? Date.now() - meta.startTime : -1;
    const status = error.response?.status ?? 0;

    console.error(
      JSON.stringify({
        level: "error",
        method: error.config?.method?.toUpperCase(),
        url: error.config?.url,
        status,
        durationMs: duration,
      })
    );

    // Build a readable error message from the Azure DevOps response body
    const responseData = error.response?.data as
      | { message?: string; errorCode?: string; typeKey?: string }
      | undefined;
    const message =
      responseData?.message ??
      responseData?.typeKey ??
      error.message ??
      "Unknown error";

    const httpError = new Error(`HTTP ${status}: ${message}`);
    (httpError as Error & { statusCode: number }).statusCode = status;
    return Promise.reject(httpError);
  }
);

export { azureClient };
