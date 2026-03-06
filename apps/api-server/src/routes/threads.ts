import { prisma } from "@smart-email/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

function serializeThread(thread: Awaited<ReturnType<typeof getThreadList>>[number]) {
  const latestMessage = thread.messages[0];

  return {
    id: thread.id,
    mailboxId: thread.mailboxId,
    subject: thread.subject,
    participants: thread.participants,
    unreadCount: thread.unreadCount,
    lastMessageAt: thread.lastMessageAt,
    mailbox: {
      id: thread.mailbox.id,
      emailAddress: thread.mailbox.emailAddress,
      displayName: thread.mailbox.displayName,
      kind: thread.mailbox.kind
    },
    latestMessage: latestMessage
      ? {
          id: latestMessage.id,
          fromName: latestMessage.fromName,
          fromAddress: latestMessage.fromAddress,
          bodyPreview: latestMessage.bodyPreview,
          receivedAt: latestMessage.receivedAt,
          isRead: latestMessage.isRead,
          hasAttachments: latestMessage.hasAttachments,
          importance: latestMessage.importance
        }
      : null
  };
}

async function getThreadList(mailboxId?: string, limit = 40) {
  return prisma.thread.findMany({
    where: mailboxId
      ? {
          mailboxId
        }
      : undefined,
    orderBy: {
      lastMessageAt: "desc"
    },
    take: limit,
    include: {
      mailbox: true,
      messages: {
        orderBy: {
          receivedAt: "desc"
        },
        take: 1
      }
    }
  });
}

export async function registerThreadRoutes(app: FastifyInstance) {
  app.get("/v1/threads", async (request) => {
    const query = z
      .object({
        mailboxId: z.string().cuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional()
      })
      .parse(request.query);

    const threads = await getThreadList(query.mailboxId, query.limit ?? 40);

    return {
      threads: threads.map(serializeThread)
    };
  });

  app.get("/v1/threads/:threadId", async (request, reply) => {
    const params = z
      .object({
        threadId: z.string().cuid()
      })
      .parse(request.params);

    const thread = await prisma.thread.findUnique({
      where: {
        id: params.threadId
      },
      include: {
        mailbox: true,
        messages: {
          orderBy: {
            receivedAt: "asc"
          }
        }
      }
    });

    if (!thread) {
      return reply.status(404).send({
        error: "Thread not found."
      });
    }

    return {
      thread: {
        id: thread.id,
        subject: thread.subject,
        participants: thread.participants,
        unreadCount: thread.unreadCount,
        lastMessageAt: thread.lastMessageAt,
        mailbox: {
          id: thread.mailbox.id,
          displayName: thread.mailbox.displayName,
          emailAddress: thread.mailbox.emailAddress,
          kind: thread.mailbox.kind
        },
        messages: thread.messages.map((message) => ({
          id: message.id,
          subject: message.subject,
          fromName: message.fromName,
          fromAddress: message.fromAddress,
          toRecipients: message.toRecipients,
          ccRecipients: message.ccRecipients,
          receivedAt: message.receivedAt,
          sentAt: message.sentAt,
          bodyPreview: message.bodyPreview,
          bodyText: message.bodyText,
          bodyHtml: message.bodyHtml,
          webLink: message.webLink,
          isRead: message.isRead,
          hasAttachments: message.hasAttachments,
          importance: message.importance
        }))
      }
    };
  });
}
