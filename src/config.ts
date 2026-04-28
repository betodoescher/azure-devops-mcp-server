import { z } from "zod";

const envSchema = z.object({
  AZURE_DEVOPS_PAT: z.string().min(1, "AZURE_DEVOPS_PAT is required"),
  AZURE_DEVOPS_ORG: z
    .string()
    .url()
    .default("https://dev.azure.com/ecoagro-tech"),
  AZURE_DEVOPS_API_VERSION: z.string().default("7.1"),
  STALE_PR_DAYS: z.coerce.number().int().positive().default(3),
  BLOCKED_ITEM_DAYS: z.coerce.number().int().positive().default(2),
  FAILING_PIPELINE_THRESHOLD: z.coerce.number().int().positive().default(3),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const field = issue.path.join(".");
        // Never expose PAT value — only report the field name and message
        return `  - ${field}: ${issue.message}`;
      })
      .join("\n");

    console.error(
      `[config] Failed to load configuration. Missing or invalid environment variables:\n${issues}\n` +
        `Please check your .env file or environment configuration.`
    );
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
