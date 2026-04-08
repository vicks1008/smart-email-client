import { z } from "zod";

const optionalString = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined;
  }

  return value;
}, z.string().optional());

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .default("postgresql://postgres:postgres@127.0.0.1:5434/smart_email?schema=public"),
  MICROSOFT_CLIENT_ID: optionalString,
  MICROSOFT_CLIENT_SECRET: optionalString,
  MICROSOFT_TENANT_ID: z.string().default("common"),
  MICROSOFT_REDIRECT_URI: z.string().url().default("http://localhost:4000/v1/auth/microsoft/callback"),
  DASHBOARD_URL: z.string().url().default("http://localhost:3000"),
  API_BASE_URL: z.string().url().default("http://localhost:4000"),
  MAIL_SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(120),
  MAIL_SYNC_MESSAGE_LIMIT: z.coerce.number().int().min(1).max(100).default(50),
  OLM_CONVERTER_PYTHON: optionalString,
  THUNDERBIRD_MCP_URL: z.string().url().default("http://127.0.0.1:8765"),
  THUNDERBIRD_SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  OUTLOOK_MCP_AUTH_SERVER_URL: z.string().url().default("http://127.0.0.1:3333"),
  OUTLOOK_MCP_TOKEN_STORE_PATH: optionalString,
  OUTLOOK_MCP_SCOPES: optionalString,
  APPLE_MAIL_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(60)
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  cachedEnv ??= envSchema.parse(process.env);
  return cachedEnv;
}

export function hasMicrosoftOAuthConfig() {
  const env = getEnv();
  return Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);
}
