import {
  accountsSettingsSchema,
  getCurrentAppSettings,
  getModelProviders,
  modelSourceCategorySchema,
  normalizeAccountsSettings,
  normalizePrivateModelsSettings,
  normalizeWorkflowsSettings,
  oauthStatusSchema,
  prisma,
  privateModelsSettingsSchema,
  publicModelsSettingsSchema,
  routingModeSchema,
  toJsonValue,
  toPublicModelsSettings,
  workflowsSettingsSchema,
  type AccountsSettings,
  type PrivateModelsSettings,
  type PublicModelsSettings,
  type WorkflowsSettings
} from "@smart-email/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
const analyticsModeSchema = z.literal("DETERMINISTIC_ONLY");

const settingsResponseSchema = z.object({
  settings: z.object({
    models: publicModelsSettingsSchema,
    accounts: accountsSettingsSchema,
    workflows: workflowsSettingsSchema
  })
});


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
    const settings = await getCurrentAppSettings();
    return serializeSettingsResponse(settings);
  });

  app.put("/v1/settings/models", async (request) => {
    const currentSettings = await getCurrentAppSettings();
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
    const currentSettings = await getCurrentAppSettings();
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
    const currentSettings = await getCurrentAppSettings();
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
      providers: getModelProviders()
    };
  });
}
