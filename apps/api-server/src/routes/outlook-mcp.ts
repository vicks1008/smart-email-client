import {
  getOutlookMcpAuthUrl,
  getOutlookMcpMessageDetail,
  getOutlookMcpRecentMessages,
  listOutlookMcpAccounts,
  listOutlookMcpFolders,
  outlookMcpSetupProbe,
  searchOutlookMcpMessages
} from "@smart-email/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

export async function registerOutlookMcpRoutes(app: FastifyInstance) {
  app.get("/v1/outlook-mcp/status", async () => {
    return outlookMcpSetupProbe();
  });

  app.get("/v1/outlook-mcp/auth/start", async (_request, reply) => {
    return reply.redirect(getOutlookMcpAuthUrl());
  });

  app.get("/v1/outlook-mcp/accounts", async (request, reply) => {
    try {
      return {
        accounts: await listOutlookMcpAccounts()
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Outlook MCP accounts are not available."
      });
    }
  });

  app.get("/v1/outlook-mcp/folders", async (request, reply) => {
    try {
      return {
        folders: await listOutlookMcpFolders()
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Outlook MCP folders are not available."
      });
    }
  });

  app.get("/v1/outlook-mcp/messages/recent", async (request, reply) => {
    const query = z
      .object({
        folderPath: z.string().optional(),
        daysBack: z.coerce.number().int().min(1).max(365).optional(),
        maxResults: z.coerce.number().int().min(1).max(100).optional()
      })
      .parse(request.query);

    try {
      return {
        messages: await getOutlookMcpRecentMessages(query)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Outlook MCP recent messages are not available."
      });
    }
  });

  app.get("/v1/outlook-mcp/messages/search", async (request, reply) => {
    const query = z
      .object({
        query: z.string().default(""),
        folderPath: z.string().optional(),
        maxResults: z.coerce.number().int().min(1).max(100).optional()
      })
      .parse(request.query);

    try {
      return {
        messages: await searchOutlookMcpMessages(query)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Outlook MCP search is not available."
      });
    }
  });

  app.get("/v1/outlook-mcp/messages/detail", async (request, reply) => {
    const query = z
      .object({
        messageId: z.string().min(1),
        folderPath: z.string().optional()
      })
      .parse(request.query);

    try {
      return {
        message: await getOutlookMcpMessageDetail(query.messageId, query.folderPath)
      };
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : "Outlook MCP message detail is not available."
      });
    }
  });
}
