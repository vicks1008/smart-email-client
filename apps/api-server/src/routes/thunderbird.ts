import {
  getThunderbirdFolderStatistics,
  getThunderbirdMessageDetail,
  getThunderbirdMessageMetadata,
  getThunderbirdRecentMessages,
  getThunderbirdRawMessage,
  getThunderbirdThreadMessages,
  listThunderbirdDiscoveredMailboxes,
  listThunderbirdAccounts,
  listThunderbirdFolders,
  listThunderbirdMessagesInFolder,
  listThunderbirdSyncSources,
  searchThunderbirdMessages,
  syncAllThunderbirdDiscoveredMailboxes,
  syncThunderbirdAccountIntoWorkbench,
  thunderbirdSetupProbe
} from "@smart-email/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

export async function registerThunderbirdRoutes(app: FastifyInstance) {
  app.get("/v1/thunderbird/discovered-mailboxes", async (request, reply) => {
    try {
      return {
        mailboxes: await listThunderbirdDiscoveredMailboxes()
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Thunderbird mailbox discovery failed."
      });
    }
  });

  app.get("/v1/thunderbird/sources", async (request, reply) => {
    try {
      return {
        sources: await listThunderbirdSyncSources()
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Thunderbird sources are not available."
      });
    }
  });

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

  app.post("/v1/thunderbird/sync-all", async (request, reply) => {
    const body = z
      .object({
        daysBack: z.coerce.number().int().min(1).max(365).optional(),
        maxMessagesPerFolder: z.coerce.number().int().min(1).max(500).optional()
      })
      .parse(request.body ?? {});

    try {
      return reply.status(201).send({
        syncs: await syncAllThunderbirdDiscoveredMailboxes(body)
      });
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Thunderbird bulk sync failed."
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

  app.get("/v1/thunderbird/folders/statistics", async (request, reply) => {
    const query = z
      .object({
        folderPath: z.string().min(1),
        includeSubfolders: z.coerce.boolean().optional()
      })
      .parse(request.query);

    try {
      return {
        statistics: await getThunderbirdFolderStatistics(query.folderPath, query.includeSubfolders ?? false)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Thunderbird folder statistics are not available."
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

  app.get("/v1/thunderbird/messages/folder", async (request, reply) => {
    const query = z
      .object({
        folderPath: z.string().min(1),
        maxResults: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        unreadOnly: z.coerce.boolean().optional(),
        flaggedOnly: z.coerce.boolean().optional(),
        includeSubfolders: z.coerce.boolean().optional(),
        sortOrder: z.enum(["asc", "desc"]).optional()
      })
      .parse(request.query);

    try {
      return {
        page: await listThunderbirdMessagesInFolder(query)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Thunderbird folder messages are not available."
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

  app.get("/v1/thunderbird/messages/metadata", async (request, reply) => {
    const query = z
      .object({
        messageId: z.string().min(1),
        folderPath: z.string().min(1)
      })
      .parse(request.query);

    try {
      return {
        message: await getThunderbirdMessageMetadata(query.messageId, query.folderPath)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Thunderbird message metadata is not available."
      });
    }
  });

  app.get("/v1/thunderbird/messages/raw", async (request, reply) => {
    const query = z
      .object({
        messageId: z.string().min(1),
        folderPath: z.string().min(1),
        maxBytes: z.coerce.number().int().min(1).max(1000000).optional()
      })
      .parse(request.query);

    try {
      return {
        message: await getThunderbirdRawMessage(query.messageId, query.folderPath, query.maxBytes)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Thunderbird raw message source is not available."
      });
    }
  });

  app.get("/v1/thunderbird/messages/thread", async (request, reply) => {
    const query = z
      .object({
        messageId: z.string().min(1),
        folderPath: z.string().min(1),
        includeBodies: z.coerce.boolean().optional(),
        maxResults: z.coerce.number().int().min(1).max(200).optional()
      })
      .parse(request.query);

    try {
      return {
        thread: await getThunderbirdThreadMessages(query)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Thunderbird thread reconstruction is not available."
      });
    }
  });
}
