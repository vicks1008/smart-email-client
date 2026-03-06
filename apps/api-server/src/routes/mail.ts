import { MailboxKind, SyncTrigger, prisma, queueAccountSync, registerMailbox } from "@smart-email/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const addMailboxSchema = z.object({
  emailAddress: z.string().email(),
  displayName: z.string().min(1).max(120).optional()
});

export async function registerMailRoutes(app: FastifyInstance) {
  app.get("/v1/mail/accounts", async () => {
    const accounts = await prisma.account.findMany({
      orderBy: {
        updatedAt: "desc"
      },
      include: {
        mailboxes: {
          include: {
            _count: {
              select: {
                threads: true,
                messages: true
              }
            }
          },
          orderBy: [
            {
              kind: "asc"
            },
            {
              emailAddress: "asc"
            }
          ]
        },
        syncJobs: {
          orderBy: {
            createdAt: "desc"
          },
          take: 3
        }
      }
    });

    return {
      accounts
    };
  });

  app.post("/v1/mail/accounts/:accountId/sync", async (request, reply) => {
    const params = z.object({
      accountId: z.string().cuid()
    }).parse(request.params);

    const account = await prisma.account.findUnique({
      where: {
        id: params.accountId
      }
    });

    if (!account) {
      return reply.status(404).send({
        error: "Account not found."
      });
    }

    const jobs = await queueAccountSync(params.accountId, SyncTrigger.MANUAL);
    return {
      queued: jobs.length
    };
  });

  app.post("/v1/mail/accounts/:accountId/mailboxes", async (request, reply) => {
    const params = z.object({
      accountId: z.string().cuid()
    }).parse(request.params);
    const body = addMailboxSchema.parse(request.body);

    const account = await prisma.account.findUnique({
      where: {
        id: params.accountId
      }
    });

    if (!account) {
      return reply.status(404).send({
        error: "Account not found."
      });
    }

    const mailbox = await registerMailbox(params.accountId, {
      emailAddress: body.emailAddress,
      displayName: body.displayName ?? body.emailAddress,
      kind: MailboxKind.SHARED
    });

    await queueAccountSync(params.accountId, SyncTrigger.MANUAL);

    return reply.status(201).send({
      mailbox
    });
  });
}
