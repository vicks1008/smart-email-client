import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  getThunderbirdMessageDetail,
  getThunderbirdRecentMessages,
  listThunderbirdAccounts,
  listThunderbirdFolders,
  searchThunderbirdMessages,
  thunderbirdSetupProbe
} from "../thunderbird";
import { syncThunderbirdAccountIntoWorkbench } from "../thunderbird-sync";

export async function registerThunderbirdRoutes(app: FastifyInstance) {
  app.post("/v1/thunderbird/sync", async (request, reply) => {
    const body = z
      .object({
        thunderbirdAccountId: z.string().min(1),
        mailboxEmail: z.string().email().optional(),
        mailboxDisplayName: z.string().min(1).max(120).optional(),
        daysBack: z.coerce.number().int().min(1).max(365).optional(),
        maxMessagesPerFolder: z.coerce.number().int().min(1).max(500).optional()
      })
      .parse(request.body);

    try {
      return reply.status(201).send({
        sync: await syncThunderbirdAccountIntoWorkbench(body)
      });
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Thunderbird sync failed."
      });
    }
  });

  app.get("/v1/thunderbird/status", async () => {
    return thunderbirdSetupProbe();
  });

  app.get("/v1/thunderbird/accounts", async (request, reply) => {
    try {
      return {
        accounts: await listThunderbirdAccounts()
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Thunderbird is not available."
      });
    }
  });

  app.get("/v1/thunderbird/folders", async (request, reply) => {
    const query = z
      .object({
        accountId: z.string().optional()
      })
      .parse(request.query);

    try {
      return {
        folders: await listThunderbirdFolders(query.accountId)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Thunderbird folders are not available."
      });
    }
  });

  app.get("/v1/thunderbird/messages/recent", async (request, reply) => {
    const query = z
      .object({
        folderPath: z.string().optional(),
        daysBack: z.coerce.number().int().min(1).max(365).optional(),
        maxResults: z.coerce.number().int().min(1).max(100).optional(),
        unreadOnly: z.coerce.boolean().optional(),
        flaggedOnly: z.coerce.boolean().optional()
      })
      .parse(request.query);

    try {
      return {
        messages: await getThunderbirdRecentMessages(query)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Thunderbird recent messages are not available."
      });
    }
  });

  app.get("/v1/thunderbird/messages/search", async (request, reply) => {
    const query = z
      .object({
        query: z.string().default(""),
        folderPath: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        maxResults: z.coerce.number().int().min(1).max(100).optional(),
        unreadOnly: z.coerce.boolean().optional(),
        flaggedOnly: z.coerce.boolean().optional(),
        sortOrder: z.enum(["asc", "desc"]).optional()
      })
      .parse(request.query);

    try {
      return {
        messages: await searchThunderbirdMessages(query)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Thunderbird search is not available."
      });
    }
  });

  app.get("/v1/thunderbird/messages/detail", async (request, reply) => {
    const query = z
      .object({
        messageId: z.string().min(1),
        folderPath: z.string().min(1)
      })
      .parse(request.query);

    try {
      return {
        message: await getThunderbirdMessageDetail(query.messageId, query.folderPath)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Thunderbird message detail is not available."
      });
    }
  });
}
