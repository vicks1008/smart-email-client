import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "./db";

const SETTINGS_SINGLETON_KEY = "default";

export const modelSourceCategorySchema = z.preprocess(
  (value) => (value === "OAUTH_CONNECTED_ASSISTANT" ? "COMPANION_ASSISTANT" : value),
  z.enum(["LOCAL_PROVIDER", "CLOUD_API_TOKEN", "COMPANION_ASSISTANT"])
);

export const routingModeSchema = z.enum(["AUTO", "EXPLICIT"]);
export const oauthStatusSchema = z.enum(["NOT_CONNECTED", "CONNECTED", "COMING_SOON"]);
export const analyticsModeSchema = z.literal("DETERMINISTIC_ONLY");

export const privateModelsSettingsSchema = z.object({
  enrichmentSource: z.object({
    category: modelSourceCategorySchema,
    providerId: z.string().min(1).max(80),
    baseUrl: z.string().trim().url().nullable(),
    defaultModel: z.string().trim().min(1).max(160),
    routingMode: routingModeSchema,
    apiToken: z.string().trim().min(1).max(4096).nullable().optional(),
    oauthStatus: oauthStatusSchema.optional(),
    oauthAccountLabel: z.string().trim().min(1).max(160).nullable().optional()
  }),
  analyticsMode: analyticsModeSchema
});

export const publicModelsSettingsSchema = z.object({
  enrichmentSource: z.object({
    category: modelSourceCategorySchema,
    providerId: z.string(),
    baseUrl: z.string().nullable(),
    defaultModel: z.string(),
    routingMode: routingModeSchema,
    apiTokenPreview: z.string().nullable().optional(),
    hasApiToken: z.boolean().optional(),
    oauthStatus: oauthStatusSchema.optional(),
    oauthAccountLabel: z.string().nullable().optional()
  }),
  analyticsMode: analyticsModeSchema
});

export const accountsSettingsSchema = z.object({
  preferredLiveSource: z.enum(["APPLE_MAIL", "MICROSOFT_GRAPH", "OUTLOOK_MCP", "THUNDERBIRD"]),
  includeSharedMailboxesInQueues: z.boolean(),
  prioritizeSharedMailboxes: z.boolean(),
  defaultSyncWindowDays: z.coerce.number().int().min(1).max(365)
});

export const workflowsSettingsSchema = z.object({
  replyQueueDefault: z.enum(["needsReply", "waitingOnThem", "allThreads"]),
  followUpSlaHours: z.coerce.number().int().min(1).max(336),
  stackToasts: z.boolean(),
  keyboardHints: z.boolean()
});

export type PrivateModelsSettings = z.infer<typeof privateModelsSettingsSchema>;
export type PublicModelsSettings = z.infer<typeof publicModelsSettingsSchema>;
export type AccountsSettings = z.infer<typeof accountsSettingsSchema>;
export type WorkflowsSettings = z.infer<typeof workflowsSettingsSchema>;

export const defaultModelsSettings: PrivateModelsSettings = {
  enrichmentSource: {
    category: "LOCAL_PROVIDER",
    providerId: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    defaultModel: "qwen2.5:7b",
    routingMode: "AUTO",
    apiToken: null
  },
  analyticsMode: "DETERMINISTIC_ONLY"
};

export const defaultAccountsSettings: AccountsSettings = {
  preferredLiveSource: "APPLE_MAIL",
  includeSharedMailboxesInQueues: true,
  prioritizeSharedMailboxes: false,
  defaultSyncWindowDays: 45
};

export const defaultWorkflowsSettings: WorkflowsSettings = {
  replyQueueDefault: "needsReply",
  followUpSlaHours: 48,
  stackToasts: true,
  keyboardHints: true
};

export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function maskTokenPreview(token: string) {
  const trimmed = token.trim();
  if (trimmed.length <= 6) {
    return `${"*".repeat(Math.max(trimmed.length - 2, 0))}${trimmed.slice(-2)}`;
  }

  return `${trimmed.slice(0, 4)}${"*".repeat(Math.max(trimmed.length - 8, 4))}${trimmed.slice(-4)}`;
}

export function normalizePrivateModelsSettings(value: Prisma.JsonValue | null | undefined): PrivateModelsSettings {
  const parsed = privateModelsSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultModelsSettings;
}

export function normalizeAccountsSettings(value: Prisma.JsonValue | null | undefined): AccountsSettings {
  const parsed = accountsSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultAccountsSettings;
}

export function normalizeWorkflowsSettings(value: Prisma.JsonValue | null | undefined): WorkflowsSettings {
  const parsed = workflowsSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultWorkflowsSettings;
}

export function toPublicModelsSettings(settings: PrivateModelsSettings): PublicModelsSettings {
  const apiToken = settings.enrichmentSource.apiToken?.trim() ?? null;

  return publicModelsSettingsSchema.parse({
    enrichmentSource: {
      category: settings.enrichmentSource.category,
      providerId: settings.enrichmentSource.providerId,
      baseUrl: settings.enrichmentSource.baseUrl,
      defaultModel: settings.enrichmentSource.defaultModel,
      routingMode: settings.enrichmentSource.routingMode,
      ...(apiToken
        ? {
            apiTokenPreview: maskTokenPreview(apiToken),
            hasApiToken: true
          }
        : {
            hasApiToken: false
          }),
      ...(settings.enrichmentSource.oauthStatus
        ? {
            oauthStatus: settings.enrichmentSource.oauthStatus
          }
        : {}),
      ...(settings.enrichmentSource.oauthAccountLabel !== undefined
        ? {
            oauthAccountLabel: settings.enrichmentSource.oauthAccountLabel ?? null
          }
        : {})
    },
    analyticsMode: settings.analyticsMode
  });
}

export async function ensureSettingsRecord() {
  const existingRecord = await prisma.appSettings.findUnique({
    where: {
      singletonKey: SETTINGS_SINGLETON_KEY
    }
  });

  if (existingRecord) {
    return existingRecord;
  }

  try {
    return await prisma.appSettings.create({
      data: {
        singletonKey: SETTINGS_SINGLETON_KEY,
        models: toJsonValue(defaultModelsSettings),
        accounts: toJsonValue(defaultAccountsSettings),
        workflows: toJsonValue(defaultWorkflowsSettings)
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.appSettings.findUniqueOrThrow({
        where: {
          singletonKey: SETTINGS_SINGLETON_KEY
        }
      });
    }

    throw error;
  }
}

export async function getCurrentAppSettings() {
  const record = await ensureSettingsRecord();
  const models = normalizePrivateModelsSettings(record.models);
  const accounts = normalizeAccountsSettings(record.accounts);
  const workflows = normalizeWorkflowsSettings(record.workflows);

  return {
    record,
    models,
    accounts,
    workflows
  };
}

export function getModelProviders() {
  return [
    {
      id: "ollama",
      name: "Ollama",
      category: "LOCAL_PROVIDER",
      defaultBaseUrl: "http://127.0.0.1:11434",
      supportsBaseUrl: true,
      supportsApiToken: false,
      supportsOAuth: false
    },
    {
      id: "lm-studio",
      name: "LM Studio",
      category: "LOCAL_PROVIDER",
      defaultBaseUrl: "http://127.0.0.1:1234/v1",
      supportsBaseUrl: true,
      supportsApiToken: false,
      supportsOAuth: false
    },
    {
      id: "local-openai-compatible",
      name: "Local OpenAI-compatible endpoint",
      category: "LOCAL_PROVIDER",
      defaultBaseUrl: "http://127.0.0.1:8080/v1",
      supportsBaseUrl: true,
      supportsApiToken: true,
      supportsOAuth: false
    },
    {
      id: "openai",
      name: "OpenAI API",
      category: "CLOUD_API_TOKEN",
      defaultBaseUrl: null,
      supportsBaseUrl: false,
      supportsApiToken: true,
      supportsOAuth: false
    },
    {
      id: "groq",
      name: "Groq API",
      category: "CLOUD_API_TOKEN",
      defaultBaseUrl: null,
      supportsBaseUrl: false,
      supportsApiToken: true,
      supportsOAuth: false
    },
    {
      id: "anthropic",
      name: "Anthropic API",
      category: "CLOUD_API_TOKEN",
      defaultBaseUrl: null,
      supportsBaseUrl: false,
      supportsApiToken: true,
      supportsOAuth: false
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      category: "CLOUD_API_TOKEN",
      defaultBaseUrl: null,
      supportsBaseUrl: false,
      supportsApiToken: true,
      supportsOAuth: false
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      category: "COMPANION_ASSISTANT",
      defaultBaseUrl: null,
      supportsBaseUrl: false,
      supportsApiToken: false,
      supportsOAuth: true,
      oauthStatus: "COMING_SOON"
    },
    {
      id: "codex",
      name: "Codex",
      category: "COMPANION_ASSISTANT",
      defaultBaseUrl: null,
      supportsBaseUrl: false,
      supportsApiToken: false,
      supportsOAuth: true,
      oauthStatus: "COMING_SOON"
    }
  ] as const;
}
