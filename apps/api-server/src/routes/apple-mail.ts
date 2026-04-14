import {
  getAppleMailMessageDetail,
  getAppleMailRecentMessages,
  getAppleMailStatus,
  ingestAppleMailAccountSummariesIntoWorkbench,
  listAppleMailAccounts,
  listAppleMailFolders,
  searchAppleMailMessages,
  syncAllAppleMailAccountsIntoWorkbench,
  syncAppleMailAccountIntoWorkbench
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

  app.post("/v1/apple-mail/sync", async (request, reply) => {
    const body = z
      .object({
        accountId: z.string().min(1),
        maxMessagesPerFolder: z.coerce.number().int().min(1).max(250).optional()
      })
      .parse(request.body ?? {});

    try {
      return {
        syncs: await syncAppleMailAccountIntoWorkbench({
          appleMailAccountId: body.accountId,
          maxMessagesPerFolder: body.maxMessagesPerFolder
        })
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Apple Mail sync failed."
      });
    }
  });

  app.post("/v1/apple-mail/sync-all", async (request, reply) => {
    const body = z
      .object({
        maxMessagesPerFolder: z.coerce.number().int().min(1).max(250).optional()
      })
      .parse(request.body ?? {});

    try {
      return {
        syncs: await syncAllAppleMailAccountsIntoWorkbench({
          maxMessagesPerFolder: body.maxMessagesPerFolder
        })
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Apple Mail sync failed."
      });
    }
  });

  app.post("/v1/apple-mail/ingest", async (request, reply) => {
    const body = z
      .object({
        account: z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          type: z.string().min(1),
          identities: z.array(
            z.object({
              id: z.string().min(1),
              email: z.string().min(1),
              name: z.string().min(1),
              isDefault: z.boolean()
            })
          )
        }),
        folders: z.array(
          z.object({
            name: z.string().min(1),
            path: z.string().min(1),
            type: z.string().min(1),
            accountId: z.string().min(1),
            totalMessages: z.number().int(),
            unreadMessages: z.number().int(),
            depth: z.number().int()
          })
        ),
        messagesByFolder: z.array(
          z.object({
            folderPath: z.string().min(1),
            messages: z.array(
              z.object({
                id: z.string().min(1),
                subject: z.string(),
                author: z.string(),
                recipients: z.string(),
                ccList: z.string().optional(),
                date: z.string().nullable(),
                folder: z.string(),
                folderPath: z.string().min(1),
                read: z.boolean(),
                flagged: z.boolean()
              })
            )
          })
        )
      })
      .parse(request.body);

    try {
      return {
        syncs: await ingestAppleMailAccountSummariesIntoWorkbench(body)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Apple Mail ingest failed."
      });
    }
  });
}
