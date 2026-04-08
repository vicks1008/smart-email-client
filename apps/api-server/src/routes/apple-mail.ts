import {
  getAppleMailMessageDetail,
  getAppleMailRecentMessages,
  getAppleMailStatus,
  listAppleMailAccounts,
  listAppleMailFolders,
  searchAppleMailMessages
} from "@smart-email/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

export async function registerAppleMailRoutes(app: FastifyInstance) {
  app.get("/v1/apple-mail/status", async () => {
    return getAppleMailStatus();
  });

  app.get("/v1/apple-mail/accounts", async (request, reply) => {
    try {
      return {
        accounts: await listAppleMailAccounts()
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Apple Mail accounts are not available."
      });
    }
  });

  app.get("/v1/apple-mail/folders", async (request, reply) => {
    const query = z
      .object({
        accountId: z.string().optional()
      })
      .parse(request.query);

    try {
      return {
        folders: await listAppleMailFolders(query.accountId)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Apple Mail folders are not available."
      });
    }
  });

  app.get("/v1/apple-mail/messages/recent", async (request, reply) => {
    const query = z
      .object({
        folderPath: z.string().optional(),
        maxResults: z.coerce.number().int().min(1).max(100).optional(),
        accountId: z.string().optional()
      })
      .parse(request.query);

    try {
      return {
        messages: await getAppleMailRecentMessages(query)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Apple Mail recent messages are not available."
      });
    }
  });

  app.get("/v1/apple-mail/messages/search", async (request, reply) => {
    const query = z
      .object({
        query: z.string().default(""),
        folderPath: z.string().optional(),
        maxResults: z.coerce.number().int().min(1).max(100).optional(),
        accountId: z.string().optional()
      })
      .parse(request.query);

    try {
      return {
        messages: await searchAppleMailMessages(query)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Apple Mail search is not available."
      });
    }
  });

  app.get("/v1/apple-mail/messages/detail", async (request, reply) => {
    const query = z
      .object({
        messageId: z.string().min(1),
        folderPath: z.string().optional()
      })
      .parse(request.query);

    try {
      return {
        message: await getAppleMailMessageDetail(query.messageId, query.folderPath)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Apple Mail message detail is not available."
      });
    }
  });
}
