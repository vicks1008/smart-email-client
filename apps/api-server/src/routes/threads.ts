import {
  FollowUpTaskStatus,
  MessageCategoryLabel,
  OrganizationKind,
  getOrganizationActivityAnalytics,
  prisma
} from "@smart-email/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

function normalizeAddress(address?: string | null) {
  return address?.trim().toLowerCase() ?? "";
}

function domainFromAddress(address?: string | null) {
  const normalized = normalizeAddress(address);
  const [, domain = ""] = normalized.split("@");
  return domain;
}

function inferredKindFromCategory(label: MessageCategoryLabel | null) {
  switch (label) {
    case MessageCategoryLabel.CLIENT:
      return OrganizationKind.CLIENT;
    case MessageCategoryLabel.LEAD:
      return OrganizationKind.LEAD;
    case MessageCategoryLabel.VENDOR:
    case MessageCategoryLabel.BILLING:
    case MessageCategoryLabel.SUPPORT:
      return OrganizationKind.VENDOR;
    case MessageCategoryLabel.INTERNAL:
      return OrganizationKind.INTERNAL;
    default:
      return OrganizationKind.UNKNOWN;
  }
}

function serializeThread(thread: Awaited<ReturnType<typeof getThreadList>>[number]) {
  const latestMessage = thread.messages[0];
  const primaryExternalParticipant =
    thread.participantsExpanded.find((participant) => !participant.isMailbox) ?? null;

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
      kind: thread.mailbox.kind,
      role: thread.mailbox.role
    },
    primaryOrganization: primaryExternalParticipant?.organization
      ? {
          id: primaryExternalParticipant.organization.id,
          name: primaryExternalParticipant.organization.name,
          kind: primaryExternalParticipant.organization.kind,
          primaryDomain: primaryExternalParticipant.organization.primaryDomain
        }
      : null,
    replyState: thread.replyState
      ? {
          status: thread.replyState.status,
          reason: thread.replyState.reason,
          confidence: thread.replyState.confidence,
          needsReply: thread.replyState.needsReply,
          waitingOnThem: thread.replyState.waitingOnThem,
          replyDueAt: thread.replyState.replyDueAt,
          staleAt: thread.replyState.staleAt,
          suggestedFollowUpAt: thread.replyState.suggestedFollowUpAt,
          isOverdue: thread.replyState.isOverdue
        }
      : null,
    latestCategory: latestMessage?.category
      ? {
          label: latestMessage.category.label,
          confidence: latestMessage.category.confidence,
          source: latestMessage.category.source
        }
      : null,
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

function endOfToday() {
  const value = new Date();
  value.setHours(23, 59, 59, 999);
  return value;
}

function monthsAgo(months: number) {
  const value = new Date();
  value.setMonth(value.getMonth() - months);
  return value;
}

function threadInclude() {
  return {
    mailbox: true,
    replyState: true,
    participantsExpanded: {
      include: {
        organization: true
      }
    },
    messages: {
      orderBy: {
        receivedAt: "desc" as const
      },
      take: 1,
      include: {
        category: true
      }
    }
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
    include: threadInclude()
  });
}

async function getWorkbenchData(mailboxId?: string, limit = 24) {
  const threads = await prisma.thread.findMany({
    where: mailboxId
      ? {
          mailboxId
        }
      : undefined,
    orderBy: {
      lastMessageAt: "desc"
    },
    take: 200,
    include: threadInclude()
  });

  const pendingTasks = await prisma.followUpTask.findMany({
    where: {
      ...(mailboxId ? { mailboxId } : {}),
      status: FollowUpTaskStatus.PENDING
    },
    include: {
      mailbox: true,
      organization: true,
      contact: true,
      thread: {
        include: {
          replyState: true
        }
      }
    },
    orderBy: {
      dueAt: "asc"
    },
    take: 100
  });

  const allNeedsReply = threads.filter((thread) => thread.replyState?.needsReply);
  const allWaitingOnThem = threads.filter((thread) => thread.replyState?.waitingOnThem);
  const orgFollowUpCounts = pendingTasks.reduce((accumulator, task) => {
    if (!task.organizationId) {
      return accumulator;
    }

    accumulator.set(task.organizationId, (accumulator.get(task.organizationId) ?? 0) + 1);
    return accumulator;
  }, new Map<string, number>());

  const needsReply = allNeedsReply
    .sort((left, right) => {
      const leftTime = left.replyState?.replyDueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = right.replyState?.replyDueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })
    .slice(0, limit)
    .map(serializeThread);

  const waitingOnThem = allWaitingOnThem
    .sort((left, right) => {
      const leftTime = left.replyState?.suggestedFollowUpAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = right.replyState?.suggestedFollowUpAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })
    .slice(0, limit)
    .map(serializeThread);

  const followUpToday = pendingTasks
    .filter((task) => task.dueAt.getTime() <= endOfToday().getTime())
    .slice(0, limit)
    .map((task) => ({
      id: task.id,
      title: task.title,
      note: task.note,
      dueAt: task.dueAt,
      mailbox: {
        id: task.mailbox.id,
        emailAddress: task.mailbox.emailAddress,
        displayName: task.mailbox.displayName,
        role: task.mailbox.role
      },
      thread: {
        id: task.thread.id,
        subject: task.thread.subject
      },
      organization: task.organization
        ? {
            id: task.organization.id,
            name: task.organization.name,
            kind: task.organization.kind
          }
        : null,
      contact: task.contact
        ? {
            id: task.contact.id,
            displayName: task.contact.displayName
          }
        : null
    }));

  const byOrganization = Array.from(
    threads.reduce((accumulator, thread) => {
      const organization = thread.participantsExpanded.find((participant) => !participant.isMailbox)?.organization;
      if (!organization) {
        return accumulator;
      }

      const current = accumulator.get(organization.id) ?? {
        id: organization.id,
        name: organization.name,
        kind: organization.kind,
        primaryDomain: organization.primaryDomain,
        needsReply: 0,
        waitingOnThem: 0,
        followUps: 0
      };

      if (thread.replyState?.needsReply) {
        current.needsReply += 1;
      }

      if (thread.replyState?.waitingOnThem) {
        current.waitingOnThem += 1;
      }

      current.followUps = orgFollowUpCounts.get(organization.id) ?? 0;
      accumulator.set(organization.id, current);
      return accumulator;
    }, new Map<string, {
      id: string;
      name: string;
      kind: string;
      primaryDomain: string | null;
      needsReply: number;
      waitingOnThem: number;
      followUps: number;
    }>())
  )
    .map(([, value]) => value)
    .sort((left, right) => right.needsReply + right.followUps - (left.needsReply + left.followUps))
    .slice(0, 10);

  const overdue = threads.filter((thread) => thread.replyState?.needsReply && thread.replyState.isOverdue).length;

  return {
    summary: {
      needsReply: allNeedsReply.length,
      waitingOnThem: allWaitingOnThem.length,
      followUpToday: pendingTasks.filter((task) => task.dueAt.getTime() <= endOfToday().getTime()).length,
      overdue
    },
    needsReply,
    waitingOnThem,
    followUpToday,
    byOrganization
  };
}

async function getOrganizationActivity(mailboxId?: string, months = 4, limit = 25) {
  const startAt = monthsAgo(months);
  const endAt = new Date();
  const mailboxes = await prisma.mailbox.findMany({
    select: {
      emailAddress: true
    }
  });
  const internalAddresses = new Set(mailboxes.map((entry) => normalizeAddress(entry.emailAddress)).filter(Boolean));
  const internalDomains = new Set(mailboxes.map((entry) => domainFromAddress(entry.emailAddress)).filter(Boolean));

  const threads = await prisma.thread.findMany({
    where: {
      ...(mailboxId ? { mailboxId } : {}),
      lastMessageAt: {
        gte: startAt
      },
      participantsExpanded: {
        some: {
          isMailbox: false,
          organizationId: {
            not: null
          }
        }
      },
      messages: {
        some: {
          receivedAt: {
            gte: startAt
          }
        }
      }
    },
    include: {
      mailbox: true,
      replyState: true,
      participantsExpanded: {
        include: {
          organization: true
        }
      },
      messages: {
        where: {
          receivedAt: {
            gte: startAt
          }
        },
        orderBy: {
          receivedAt: "desc"
        },
        include: {
          category: {
            select: {
              label: true
            }
          }
        }
      }
    }
  });

  const totals = threads.reduce(
    (accumulator, thread) => {
      const organization =
        thread.participantsExpanded.find(
          (participant) => !participant.isMailbox && participant.organization && participant.organization.kind !== "INTERNAL"
        )?.organization ?? null;

      if (!organization) {
        return accumulator;
      }

      const current = accumulator.organizations.get(organization.id) ?? {
        organizationId: organization.id,
        name: organization.name,
        kind: organization.kind,
        inferredKind: organization.kind,
        primaryDomain: organization.primaryDomain,
        dominantCategory: null as null,
        threadCount: 0,
        messageCount: 0,
        inboundMessageCount: 0,
        outboundMessageCount: 0,
        uniqueContactCount: 0,
        needsReply: 0,
        waitingOnThem: 0,
        lastMessageAt: thread.lastMessageAt,
        mailboxes: new Set<string>(),
        contacts: new Set<string>(),
        categoryCounts: new Map<MessageCategoryLabel, number>()
      };

      current.threadCount += 1;
      current.needsReply += thread.replyState?.needsReply ? 1 : 0;
      current.waitingOnThem += thread.replyState?.waitingOnThem ? 1 : 0;
      current.mailboxes.add(thread.mailbox.displayName);
      thread.participantsExpanded
        .filter((participant) => !participant.isMailbox && participant.organizationId === organization.id)
        .forEach((participant) => current.contacts.add(participant.emailAddress));

      for (const message of thread.messages) {
        current.messageCount += 1;
        if (message.receivedAt > current.lastMessageAt) {
          current.lastMessageAt = message.receivedAt;
        }

        if (message.category?.label) {
          current.categoryCounts.set(message.category.label, (current.categoryCounts.get(message.category.label) ?? 0) + 1);
        }

        const normalizedFrom = normalizeAddress(message.fromAddress);
        const fromDomain = domainFromAddress(normalizedFrom);
        const isOutbound = internalAddresses.has(normalizedFrom) || internalDomains.has(fromDomain);
        if (isOutbound) {
          current.outboundMessageCount += 1;
        } else {
          current.inboundMessageCount += 1;
        }
      }

      accumulator.organizations.set(organization.id, current);
      accumulator.threadCount += 1;
      accumulator.messageCount += thread.messages.length;
      return accumulator;
    },
    {
      organizations: new Map<
        string,
        {
          organizationId: string;
          name: string;
          kind: string;
          inferredKind: string;
          primaryDomain: string | null;
          dominantCategory: null;
          threadCount: number;
          messageCount: number;
          inboundMessageCount: number;
          outboundMessageCount: number;
          uniqueContactCount: number;
          needsReply: number;
          waitingOnThem: number;
          lastMessageAt: Date;
          mailboxes: Set<string>;
          contacts: Set<string>;
          categoryCounts: Map<MessageCategoryLabel, number>;
        }
      >(),
      threadCount: 0,
      messageCount: 0
    }
  );

  const organizations = Array.from(totals.organizations.values())
    .map((organization) => {
      const dominantCategory =
        Array.from(organization.categoryCounts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
      const inferredKind =
        organization.kind === OrganizationKind.UNKNOWN ? inferredKindFromCategory(dominantCategory) : organization.kind;

      return {
        ...organization,
        dominantCategory,
        inferredKind
      };
    })
    .filter((organization) => organization.inferredKind === OrganizationKind.CLIENT)
    .sort((left, right) => {
      if (right.messageCount !== left.messageCount) {
        return right.messageCount - left.messageCount;
      }

      if (right.threadCount !== left.threadCount) {
        return right.threadCount - left.threadCount;
      }

      return right.lastMessageAt.getTime() - left.lastMessageAt.getTime();
    })
    .slice(0, limit)
    .map((organization) => ({
      organizationId: organization.organizationId,
      name: organization.name,
      kind: organization.kind,
      inferredKind: organization.inferredKind,
      primaryDomain: organization.primaryDomain,
      dominantCategory: organization.dominantCategory,
      threadCount: organization.threadCount,
      messageCount: organization.messageCount,
      inboundMessageCount: organization.inboundMessageCount,
      outboundMessageCount: organization.outboundMessageCount,
      uniqueContactCount: organization.contacts.size,
      lastMessageAt: organization.lastMessageAt,
      openNeedsReplyCount: organization.needsReply,
      waitingOnThemCount: organization.waitingOnThem,
      mailboxes: Array.from(organization.mailboxes.values()).sort(),
      activityShare: totals.messageCount > 0 ? Number((organization.messageCount / totals.messageCount).toFixed(4)) : 0
    }));

  return {
    window: {
      months,
      startAt,
      endAt
    },
    summary: {
      organizationCount: organizations.length,
      threadCount: totals.threadCount,
      messageCount: totals.messageCount,
      inboundMessageCount: organizations.reduce((sum, organization) => sum + organization.inboundMessageCount, 0),
      outboundMessageCount: organizations.reduce((sum, organization) => sum + organization.outboundMessageCount, 0),
      uniqueContactCount: organizations.reduce((sum, organization) => sum + organization.uniqueContactCount, 0)
    },
    organizations
  };
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

  app.get("/v1/workbench", async (request) => {
    const query = z
      .object({
        mailboxId: z.string().cuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional()
      })
      .parse(request.query);

    return getWorkbenchData(query.mailboxId, query.limit ?? 24);
  });

  app.get("/v1/analytics/organizations/activity", async (request) => {
    const query = z
      .object({
        mailboxId: z.string().cuid().optional(),
        months: z.coerce.number().int().min(1).max(24).optional(),
        limit: z.coerce.number().int().min(1).max(50).optional()
      })
      .parse(request.query);

    return getOrganizationActivityAnalytics({
      mailboxId: query.mailboxId,
      months: query.months ?? 4,
      limit: query.limit ?? 25
    });
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
        replyState: true,
        participantsExpanded: {
          include: {
            contact: {
              include: {
                emailAddresses: true
              }
            },
            organization: true
          }
        },
        followUpTasks: {
          where: {
            status: FollowUpTaskStatus.PENDING
          },
          orderBy: {
            dueAt: "asc"
          }
        },
        messages: {
          orderBy: {
            receivedAt: "asc"
          },
          include: {
            category: true
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
          kind: thread.mailbox.kind,
          role: thread.mailbox.role
        },
        replyState: thread.replyState
          ? {
              status: thread.replyState.status,
              reason: thread.replyState.reason,
              confidence: thread.replyState.confidence,
              needsReply: thread.replyState.needsReply,
              waitingOnThem: thread.replyState.waitingOnThem,
              replyDueAt: thread.replyState.replyDueAt,
              staleAt: thread.replyState.staleAt,
              suggestedFollowUpAt: thread.replyState.suggestedFollowUpAt,
              isOverdue: thread.replyState.isOverdue
            }
          : null,
        people: thread.participantsExpanded.map((participant) => ({
          id: participant.id,
          emailAddress: participant.emailAddress,
          displayName: participant.displayName,
          isMailbox: participant.isMailbox,
          isSharedMailbox: participant.isSharedMailbox,
          organization: participant.organization
            ? {
                id: participant.organization.id,
                name: participant.organization.name,
                kind: participant.organization.kind,
                primaryDomain: participant.organization.primaryDomain
              }
            : null,
          contact: participant.contact
            ? {
                id: participant.contact.id,
                displayName: participant.contact.displayName,
                roleTitle: participant.contact.roleTitle,
                isMailboxOwner: participant.contact.isMailboxOwner,
                emailAddresses: participant.contact.emailAddresses.map((emailAddress) => emailAddress.emailAddress)
              }
            : null
        })),
        followUpTasks: thread.followUpTasks.map((task) => ({
          id: task.id,
          title: task.title,
          note: task.note,
          dueAt: task.dueAt,
          status: task.status
        })),
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
          importance: message.importance,
          category: message.category
            ? {
                label: message.category.label,
                confidence: message.category.confidence,
                source: message.category.source
              }
            : null
        }))
      }
    };
  });
}
