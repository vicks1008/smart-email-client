import { Prisma, prisma } from "@smart-email/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const SETTINGS_SINGLETON_KEY = "default";

const modelSourceCategorySchema = z.enum([
  "LOCAL_PROVIDER",
  "CLOUD_API_TOKEN",
  "OAUTH_CONNECTED_ASSISTANT"
]);

const routingModeSchema = z.enum(["AUTO", "EXPLICIT"]);
const oauthStatusSchema = z.enum(["NOT_CONNECTED", "CONNECTED", "COMING_SOON"]);
const analyticsModeSchema = z.literal("DETERMINISTIC_ONLY");

const privateModelsSettingsSchema = z.object({
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

const publicModelsSettingsSchema = z.object({
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

const accountsSettingsSchema = z.object({
  preferredLiveSource: z.enum(["APPLE_MAIL", "MICROSOFT_GRAPH", "OUTLOOK_MCP", "THUNDERBIRD"]),
  includeSharedMailboxesInQueues: z.boolean(),
  prioritizeSharedMailboxes: z.boolean(),
  defaultSyncWindowDays: z.coerce.number().int().min(1).max(365)
});

const workflowsSettingsSchema = z.object({
  replyQueueDefault: z.enum(["needsReply", "waitingOnThem", "allThreads"]),
  followUpSlaHours: z.coerce.number().int().min(1).max(336),
  stackToasts: z.boolean(),
  keyboardHints: z.boolean()
});

const settingsResponseSchema = z.object({
  settings: z.object({
    models: publicModelsSettingsSchema,
    accounts: accountsSettingsSchema,
    workflows: workflowsSettingsSchema
  })
});

type PrivateModelsSettings = z.infer<typeof privateModelsSettingsSchema>;
type PublicModelsSettings = z.infer<typeof publicModelsSettingsSchema>;
type AccountsSettings = z.infer<typeof accountsSettingsSchema>;
type WorkflowsSettings = z.infer<typeof workflowsSettingsSchema>;

const defaultModelsSettings: PrivateModelsSettings = {
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

const defaultAccountsSettings: AccountsSettings = {
  preferredLiveSource: "APPLE_MAIL",
  includeSharedMailboxesInQueues: true,
  prioritizeSharedMailboxes: false,
  defaultSyncWindowDays: 45
};

const defaultWorkflowsSettings: WorkflowsSettings = {
  replyQueueDefault: "needsReply",
  followUpSlaHours: 48,
  stackToasts: true,
  keyboardHints: true
};

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function maskTokenPreview(token: string) {
  const trimmed = token.trim();
  if (trimmed.length <= 6) {
    return `${"*".repeat(Math.max(trimmed.length - 2, 0))}${trimmed.slice(-2)}`;
  }

  return `${trimmed.slice(0, 4)}${"*".repeat(Math.max(trimmed.length - 8, 4))}${trimmed.slice(-4)}`;
}

function normalizePrivateModelsSettings(value: Prisma.JsonValue | null | undefined): PrivateModelsSettings {
  const parsed = privateModelsSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultModelsSettings;
}

function normalizeAccountsSettings(value: Prisma.JsonValue | null | undefined): AccountsSettings {
  const parsed = accountsSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultAccountsSettings;
}

function normalizeWorkflowsSettings(value: Prisma.JsonValue | null | undefined): WorkflowsSettings {
  const parsed = workflowsSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultWorkflowsSettings;
}

function toPublicModelsSettings(settings: PrivateModelsSettings): PublicModelsSettings {
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

async function ensureSettingsRecord() {
  return prisma.appSettings.upsert({
    where: {
      singletonKey: SETTINGS_SINGLETON_KEY
    },
    update: {},
    create: {
      singletonKey: SETTINGS_SINGLETON_KEY,
      models: toJsonValue(defaultModelsSettings),
      accounts: toJsonValue(defaultAccountsSettings),
      workflows: toJsonValue(defaultWorkflowsSettings)
    }
  });
}

async function getCurrentSettings() {
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

function normalizeModelsUpdate(body: unknown, current: PrivateModelsSettings) {
  const parsedBody = z
    .object({
      settings: z.object({
        enrichmentSource: z.object({
          category: modelSourceCategorySchema,
          providerId: z.string().min(1).max(80),
          baseUrl: z.union([z.string().trim().url(), z.literal(""), z.null()]).optional(),
          defaultModel: z.string().trim().min(1).max(160),
          routingMode: routingModeSchema,
          apiToken: z.union([z.string().trim().max(4096), z.null()]).optional(),
          oauthStatus: oauthStatusSchema.optional(),
          oauthAccountLabel: z.union([z.string().trim().min(1).max(160), z.literal(""), z.null()]).optional()
        }),
        analyticsMode: analyticsModeSchema.optional()
      })
    })
    .parse(body);

  const nextApiToken =
    parsedBody.settings.enrichmentSource.apiToken === undefined
      ? current.enrichmentSource.apiToken ?? null
      : parsedBody.settings.enrichmentSource.apiToken?.trim() || null;

  return privateModelsSettingsSchema.parse({
    enrichmentSource: {
      category: parsedBody.settings.enrichmentSource.category,
      providerId: parsedBody.settings.enrichmentSource.providerId,
      baseUrl:
        parsedBody.settings.enrichmentSource.baseUrl === undefined
          ? current.enrichmentSource.baseUrl
          : parsedBody.settings.enrichmentSource.baseUrl?.trim() || null,
      defaultModel: parsedBody.settings.enrichmentSource.defaultModel,
      routingMode: parsedBody.settings.enrichmentSource.routingMode,
      apiToken: nextApiToken,
      oauthStatus: parsedBody.settings.enrichmentSource.oauthStatus,
      oauthAccountLabel:
        parsedBody.settings.enrichmentSource.oauthAccountLabel === undefined
          ? current.enrichmentSource.oauthAccountLabel
          : parsedBody.settings.enrichmentSource.oauthAccountLabel?.trim() || null
    },
    analyticsMode: "DETERMINISTIC_ONLY"
  });
}

function normalizeAccountsUpdate(body: unknown) {
  const parsedBody = z
    .object({
      settings: accountsSettingsSchema
    })
    .parse(body);

  return accountsSettingsSchema.parse(parsedBody.settings);
}

function normalizeWorkflowsUpdate(body: unknown) {
  const parsedBody = z
    .object({
      settings: workflowsSettingsSchema
    })
    .parse(body);

  return workflowsSettingsSchema.parse(parsedBody.settings);
}

function serializeSettingsResponse(settings: {
  models: PrivateModelsSettings;
  accounts: AccountsSettings;
  workflows: WorkflowsSettings;
}) {
  return settingsResponseSchema.parse({
    settings: {
      models: toPublicModelsSettings(settings.models),
      accounts: settings.accounts,
      workflows: settings.workflows
    }
  });
}

export async function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/v1/settings", async () => {
    const settings = await getCurrentSettings();
    return serializeSettingsResponse(settings);
  });

  app.put("/v1/settings/models", async (request) => {
    const currentSettings = await getCurrentSettings();
    const models = normalizeModelsUpdate(request.body, currentSettings.models);

    const updatedRecord = await prisma.appSettings.update({
      where: {
        id: currentSettings.record.id
      },
      data: {
        models: toJsonValue(models)
      }
    });

    return {
      settings: toPublicModelsSettings(normalizePrivateModelsSettings(updatedRecord.models))
    };
  });

  app.put("/v1/settings/accounts", async (request) => {
    const currentSettings = await getCurrentSettings();
    const accounts = normalizeAccountsUpdate(request.body);

    const updatedRecord = await prisma.appSettings.update({
      where: {
        id: currentSettings.record.id
      },
      data: {
        accounts: toJsonValue(accounts)
      }
    });

    return {
      settings: normalizeAccountsSettings(updatedRecord.accounts)
    };
  });

  app.put("/v1/settings/workflows", async (request) => {
    const currentSettings = await getCurrentSettings();
    const workflows = normalizeWorkflowsUpdate(request.body);

    const updatedRecord = await prisma.appSettings.update({
      where: {
        id: currentSettings.record.id
      },
      data: {
        workflows: toJsonValue(workflows)
      }
    });

    return {
      settings: normalizeWorkflowsSettings(updatedRecord.workflows)
    };
  });

  app.get("/v1/model-providers", async () => {
    return {
      providers: [
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
          category: "OAUTH_CONNECTED_ASSISTANT",
          defaultBaseUrl: null,
          supportsBaseUrl: false,
          supportsApiToken: false,
          supportsOAuth: true,
          oauthStatus: "COMING_SOON"
        },
        {
          id: "codex",
          name: "Codex",
          category: "OAUTH_CONNECTED_ASSISTANT",
          defaultBaseUrl: null,
          supportsBaseUrl: false,
          supportsApiToken: false,
          supportsOAuth: true,
          oauthStatus: "COMING_SOON"
        }
      ]
    };
  });
}
