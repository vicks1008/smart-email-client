import {
  FollowUpTaskSource,
  FollowUpTaskStatus,
  MessageCategoryLabel,
  OrganizationKind,
  getCurrentAppSettings,
  prisma,
  toPublicModelsSettings
} from "@smart-email/core";
import type { FastifyInstance, FastifyReply } from "fastify";
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

function addHours(value: Date, hours: number) {
  return new Date(value.getTime() + hours * 60 * 60 * 1000);
}

function clipSentence(value: string, fallback: string, maxLength = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function threadListInclude() {
  return {
    mailbox: true,
    replyState: true,
    participantsExpanded: {
      include: {
        organization: true
      }
    },
    followUpTasks: {
      where: {
        status: FollowUpTaskStatus.PENDING
      },
      orderBy: {
        dueAt: "asc" as const
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

function threadDetailInclude() {
  return {
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
        dueAt: "asc" as const
      }
    },
    messages: {
      orderBy: {
        receivedAt: "asc" as const
      },
      include: {
        category: true
      }
    }
  };
}

function threadStatusInclude() {
  return {
    mailbox: true,
    replyState: true,
    followUpTasks: {
      where: {
        status: FollowUpTaskStatus.PENDING
      },
      orderBy: {
        dueAt: "asc" as const
      }
    },
    messages: {
      orderBy: {
        receivedAt: "desc" as const
      },
      take: 1
    }
  };
}

type ThreadListRecord = Awaited<ReturnType<typeof getThreadList>>[number];
type ThreadDetailRecord = NonNullable<Awaited<ReturnType<typeof getThreadDetailRecord>>>;
type ThreadStatusRecord = NonNullable<Awaited<ReturnType<typeof getThreadStatusRecord>>>;
type ThreadStatusLike = {
  id: string;
  mailboxId: string;
  subject: string;
  unreadCount: number;
  archivedAt: Date | null;
  lastMessageAt: Date;
  mailbox: ThreadStatusRecord["mailbox"];
  replyState: ThreadStatusRecord["replyState"];
  followUpTasks: ThreadStatusRecord["followUpTasks"];
  messages: ThreadStatusRecord["messages"];
};

function serializeReplyState(
  replyState: ThreadListRecord["replyState"] | ThreadDetailRecord["replyState"] | ThreadStatusRecord["replyState"]
) {
  return replyState
    ? {
        status: replyState.status,
        reason: replyState.reason,
        confidence: replyState.confidence,
        needsReply: replyState.needsReply,
        waitingOnThem: replyState.waitingOnThem,
        replyDueAt: replyState.replyDueAt,
        staleAt: replyState.staleAt,
        suggestedFollowUpAt: replyState.suggestedFollowUpAt,
        isOverdue: replyState.isOverdue
      }
    : null;
}

function serializeMailbox(
  mailbox: ThreadListRecord["mailbox"] | ThreadDetailRecord["mailbox"] | ThreadStatusRecord["mailbox"]
) {
  return {
    id: mailbox.id,
    emailAddress: mailbox.emailAddress,
    displayName: mailbox.displayName,
    kind: mailbox.kind,
    role: mailbox.role
  };
}

function serializePendingFollowUp(task: ThreadListRecord["followUpTasks"][number] | ThreadDetailRecord["followUpTasks"][number]) {
  return {
    id: task.id,
    title: task.title,
    note: task.note,
    dueAt: task.dueAt,
    status: task.status
  };
}

function serializeThreadStatus(thread: ThreadStatusLike) {
  const latestMessage = thread.messages[0] ?? null;
  const nextFollowUp = thread.followUpTasks[0] ?? null;

  return {
    id: thread.id,
    mailboxId: thread.mailboxId,
    subject: thread.subject,
    unreadCount: thread.unreadCount,
    archivedAt: thread.archivedAt,
    lastMessageAt: thread.lastMessageAt,
    mailbox: serializeMailbox(thread.mailbox),
    replyState: serializeReplyState(thread.replyState),
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
      : null,
    followUp: {
      pendingCount: thread.followUpTasks.length,
      nextDueAt: nextFollowUp?.dueAt ?? null,
      nextTask: nextFollowUp ? serializePendingFollowUp(nextFollowUp) : null
    }
  };
}

function serializeThread(thread: ThreadListRecord) {
  const latestMessage = thread.messages[0];
  const primaryExternalParticipant =
    thread.participantsExpanded.find((participant) => !participant.isMailbox) ?? null;

  return {
    id: thread.id,
    mailboxId: thread.mailboxId,
    subject: thread.subject,
    participants: thread.participants,
    unreadCount: thread.unreadCount,
    archivedAt: thread.archivedAt,
    lastMessageAt: thread.lastMessageAt,
    mailbox: serializeMailbox(thread.mailbox),
    primaryOrganization: primaryExternalParticipant?.organization
      ? {
          id: primaryExternalParticipant.organization.id,
          name: primaryExternalParticipant.organization.name,
          kind: primaryExternalParticipant.organization.kind,
          primaryDomain: primaryExternalParticipant.organization.primaryDomain
        }
      : null,
    replyState: serializeReplyState(thread.replyState),
    followUp: {
      pendingCount: thread.followUpTasks.length,
      nextDueAt: thread.followUpTasks[0]?.dueAt ?? null
    },
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

async function getThreadList(mailboxId?: string, limit = 40, includeArchived = false) {
  return prisma.thread.findMany({
    where: {
      ...(mailboxId ? { mailboxId } : {}),
      ...(includeArchived ? {} : { archivedAt: null })
    },
    orderBy: {
      lastMessageAt: "desc"
    },
    take: limit,
    include: threadListInclude()
  });
}

async function getWorkbenchData(mailboxId?: string, limit = 24, includeArchived = false) {
  const threadWhere = {
    ...(mailboxId ? { mailboxId } : {}),
    ...(includeArchived ? {} : { archivedAt: null })
  };

  const threads = await prisma.thread.findMany({
    where: threadWhere,
    orderBy: {
      lastMessageAt: "desc"
    },
    take: 200,
    include: threadListInclude()
  });

  const pendingTasks = await prisma.followUpTask.findMany({
    where: {
      ...(mailboxId ? { mailboxId } : {}),
      status: FollowUpTaskStatus.PENDING,
      ...(includeArchived
        ? {}
        : {
            thread: {
              is: {
                archivedAt: null
              }
            }
          })
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
          inferredKind: OrganizationKind;
          primaryDomain: string | null;
          dominantCategory: MessageCategoryLabel | null;
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
      activityShare: 0
    }));

  const summary = {
    organizationCount: organizations.length,
    threadCount: organizations.reduce((sum, organization) => sum + organization.threadCount, 0),
    messageCount: organizations.reduce((sum, organization) => sum + organization.messageCount, 0),
    inboundMessageCount: organizations.reduce((sum, organization) => sum + organization.inboundMessageCount, 0),
    outboundMessageCount: organizations.reduce((sum, organization) => sum + organization.outboundMessageCount, 0),
    uniqueContactCount: organizations.reduce((sum, organization) => sum + organization.uniqueContactCount, 0)
  };

  const organizationsWithShare = organizations.map((organization) => ({
    ...organization,
    activityShare: summary.messageCount > 0 ? Number((organization.messageCount / summary.messageCount).toFixed(4)) : 0
  }));

  return {
    window: {
      months,
      startAt,
      endAt
    },
    summary,
    organizations: organizationsWithShare
  };
}

async function getThreadDetailRecord(threadId: string) {
  return prisma.thread.findUnique({
    where: {
      id: threadId
    },
    include: threadDetailInclude()
  });
}

async function getThreadStatusRecord(threadId: string) {
  return prisma.thread.findUnique({
    where: {
      id: threadId
    },
    include: threadStatusInclude()
  });
}

async function requireThreadStatus(threadId: string, reply: FastifyReply) {
  const thread = await getThreadStatusRecord(threadId);
  if (!thread) {
    await reply.status(404).send({
      error: "Thread not found."
    });
    return null;
  }

  return thread;
}

function serializeThreadDetail(thread: ThreadDetailRecord) {
  return {
    thread: {
      id: thread.id,
      subject: thread.subject,
      participants: thread.participants,
      unreadCount: thread.unreadCount,
      archivedAt: thread.archivedAt,
      lastMessageAt: thread.lastMessageAt,
      mailbox: serializeMailbox(thread.mailbox),
      replyState: serializeReplyState(thread.replyState),
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
      followUpTasks: thread.followUpTasks.map(serializePendingFollowUp),
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
}

function getMailboxAddressSet(thread: ThreadDetailRecord) {
  return new Set(
    [
      thread.mailbox.emailAddress,
      ...thread.participantsExpanded.filter((participant) => participant.isMailbox).map((participant) => participant.emailAddress)
    ]
      .map((value) => normalizeAddress(value))
      .filter(Boolean)
  );
}

function getLatestInboundMessage(thread: ThreadDetailRecord) {
  const mailboxAddresses = getMailboxAddressSet(thread);

  return (
    [...thread.messages]
      .reverse()
      .find((message) => {
        const fromAddress = normalizeAddress(message.fromAddress);
        return fromAddress && !mailboxAddresses.has(fromAddress);
      }) ?? null
  );
}

function getLatestOutboundMessage(thread: ThreadDetailRecord) {
  const mailboxAddresses = getMailboxAddressSet(thread);

  return (
    [...thread.messages]
      .reverse()
      .find((message) => {
        const fromAddress = normalizeAddress(message.fromAddress);
        return fromAddress && mailboxAddresses.has(fromAddress);
      }) ?? null
  );
}

async function buildAssistantPayload(thread: ThreadDetailRecord) {
  const settings = await getCurrentAppSettings();
  const publicModels = toPublicModelsSettings(settings.models);
  const primaryExternalParticipant =
    thread.participantsExpanded.find((participant) => !participant.isMailbox) ?? null;
  const latestMessage = thread.messages[thread.messages.length - 1] ?? null;
  const latestInboundMessage = getLatestInboundMessage(thread);
  const latestOutboundMessage = getLatestOutboundMessage(thread);
  const pendingFollowUp = thread.followUpTasks[0] ?? null;
  const organization = primaryExternalParticipant?.organization ?? null;
  const contact = primaryExternalParticipant?.contact ?? null;
  const counterpartName =
    primaryExternalParticipant?.displayName ||
    contact?.displayName ||
    organization?.name ||
    latestInboundMessage?.fromName ||
    latestInboundMessage?.fromAddress ||
    "the sender";
  const summarySource =
    latestInboundMessage?.bodyPreview ||
    latestMessage?.bodyPreview ||
    thread.subject ||
    "Recent activity is available in the thread.";
  const conciseSummary = clipSentence(
    `${thread.subject || "Untitled thread"} with ${counterpartName}. ${summarySource}`,
    "Recent activity is available in the thread."
  );

  const whyParts = [
    thread.replyState?.needsReply
      ? thread.replyState.isOverdue
        ? "A reply is overdue based on deterministic reply-state scoring."
        : "Deterministic reply-state scoring says a response is still owed."
      : null,
    thread.replyState?.waitingOnThem
      ? "The thread is waiting on the other side, so a follow-up matters more than a fresh reply."
      : null,
    thread.unreadCount > 0
      ? `${thread.unreadCount} message${thread.unreadCount === 1 ? "" : "s"} in this thread are still unread.`
      : null,
    pendingFollowUp ? `There is already a follow-up task due ${pendingFollowUp.dueAt.toISOString()}.` : null,
    thread.mailbox.role !== "PERSONAL" ? `This lives in a ${thread.mailbox.role.toLowerCase()} mailbox.` : null
  ].filter(Boolean);

  const whyItMatters = whyParts.join(" ") || "The thread has structured context available, but no urgent signal is currently active.";

  const suggestedNextStep =
    thread.replyState?.needsReply
      ? {
          action: "reply",
          label: thread.replyState.isOverdue ? "Send a concise reply now" : "Draft a reply for review",
          rationale: thread.replyState.reason
        }
      : thread.replyState?.waitingOnThem
        ? {
            action: "follow_up",
            label: pendingFollowUp ? "Review the scheduled follow-up" : "Set a reminder and follow up later",
            rationale: thread.replyState.reason
          }
        : thread.archivedAt
          ? {
              action: "unarchive",
              label: "Restore the thread only if it needs active work",
              rationale: "The thread is already cleared from active queues."
            }
          : {
              action: "review",
              label: "Review the latest message and decide if the thread can be archived",
              rationale: "No deterministic urgency signal is currently active."
            };

  const followUpSignal = {
    status: pendingFollowUp
      ? "FOLLOW_UP_SCHEDULED"
      : thread.replyState?.needsReply
        ? "REPLY_NEEDED"
        : thread.replyState?.waitingOnThem
          ? "WAITING_ON_THEM"
          : "NO_ACTIVE_SIGNAL",
    replyDueAt: thread.replyState?.replyDueAt ?? null,
    staleAt: thread.replyState?.staleAt ?? null,
    suggestedFollowUpAt: thread.replyState?.suggestedFollowUpAt ?? null,
    pendingTaskCount: thread.followUpTasks.length,
    nextFollowUpTask: pendingFollowUp ? serializePendingFollowUp(pendingFollowUp) : null
  };

  const replyContext = latestInboundMessage?.bodyPreview || latestMessage?.bodyPreview || thread.subject;
  const conciseDraft = `Hi ${counterpartName.split(" ")[0]},\n\nThanks for the update on ${thread.subject || "this thread"}. I reviewed the latest details and will take the next step from here.\n\n${replyContext ? `My read on the latest point: ${clipSentence(replyContext, "", 120)}\n\n` : ""}Best,\n${thread.mailbox.displayName}`;
  const actionDraft = `Hi ${counterpartName.split(" ")[0]},\n\nFollowing up on ${thread.subject || "this thread"}.\n\n${thread.replyState?.needsReply ? "Here is the next step we can take:" : "I wanted to check where this stands:"} ${thread.replyState?.reason || "I reviewed the thread context and want to keep it moving."}\n\nIf helpful, I can send over a tighter update once you confirm timing.\n\nBest,\n${thread.mailbox.displayName}`;
  const followUpDueAt = pendingFollowUp?.dueAt ?? thread.replyState?.suggestedFollowUpAt ?? addHours(new Date(), settings.workflows.followUpSlaHours);

  return {
    assistant: {
      threadId: thread.id,
      generationMode: "DETERMINISTIC_TEMPLATE_ROUTED",
      modelRouting: {
        category: publicModels.enrichmentSource.category,
        providerId: publicModels.enrichmentSource.providerId,
        baseUrl: publicModels.enrichmentSource.baseUrl,
        defaultModel: publicModels.enrichmentSource.defaultModel,
        routingMode: publicModels.enrichmentSource.routingMode,
        analyticsMode: publicModels.analyticsMode,
        hasApiToken: publicModels.enrichmentSource.hasApiToken ?? false,
        oauthStatus: publicModels.enrichmentSource.oauthStatus ?? null,
        oauthAccountLabel: publicModels.enrichmentSource.oauthAccountLabel ?? null,
        deterministicAnalyticsIndependent: true
      },
      groundedThreadIntelligence: {
        conciseSummary,
        whyItMatters,
        suggestedNextStep,
        followUpSignal,
        draftVariants: [
          {
            id: "concise-reply",
            label: "Concise reply",
            tone: "direct",
            body: conciseDraft
          },
          {
            id: "next-step-reply",
            label: "Next-step reply",
            tone: "collaborative",
            body: actionDraft
          }
        ],
        draftSuggestions: [
          thread.replyState?.needsReply
            ? "Acknowledge the latest inbound message, answer the open point, and propose the next step."
            : "Confirm whether a reply is needed before sending anything new.",
          thread.mailbox.role !== "PERSONAL"
            ? "Keep the wording easy for a shared mailbox teammate to inherit."
            : "Keep the wording compact and decision-oriented.",
          `If no reply is sent, schedule a reminder for ${followUpDueAt.toISOString()}.`
        ],
        context: {
          subject: thread.subject,
          mailbox: serializeMailbox(thread.mailbox),
          primaryOrganization: organization
            ? {
                id: organization.id,
                name: organization.name,
                kind: organization.kind,
                primaryDomain: organization.primaryDomain
              }
            : null,
          primaryContact: primaryExternalParticipant
            ? {
                emailAddress: primaryExternalParticipant.emailAddress,
                displayName: primaryExternalParticipant.displayName,
                roleTitle: contact?.roleTitle ?? null
              }
            : null,
          latestInboundAt: latestInboundMessage?.receivedAt ?? null,
          latestOutboundAt: latestOutboundMessage?.receivedAt ?? null,
          unreadCount: thread.unreadCount,
          archivedAt: thread.archivedAt
        }
      },
      threadStatus: serializeThreadStatus({
        id: thread.id,
        mailboxId: thread.mailboxId,
        subject: thread.subject,
        unreadCount: thread.unreadCount,
        archivedAt: thread.archivedAt,
        lastMessageAt: thread.lastMessageAt,
        mailbox: thread.mailbox,
        replyState: thread.replyState,
        followUpTasks: thread.followUpTasks,
        messages: latestMessage ? [latestMessage] : []
      })
    }
  };
}

export async function registerThreadRoutes(app: FastifyInstance) {
  app.get("/v1/threads", async (request) => {
    const query = z
      .object({
        mailboxId: z.string().cuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        includeArchived: z.coerce.boolean().optional()
      })
      .parse(request.query);

    const threads = await getThreadList(query.mailboxId, query.limit ?? 40, query.includeArchived ?? false);

    return {
      threads: threads.map(serializeThread)
    };
  });

  app.get("/v1/workbench", async (request) => {
    const query = z
      .object({
        mailboxId: z.string().cuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        includeArchived: z.coerce.boolean().optional()
      })
      .parse(request.query);

    return getWorkbenchData(query.mailboxId, query.limit ?? 24, query.includeArchived ?? false);
  });

  app.get("/v1/analytics/organizations/activity", async (request) => {
    const query = z
      .object({
        mailboxId: z.string().cuid().optional(),
        months: z.coerce.number().int().min(1).max(24).optional(),
        limit: z.coerce.number().int().min(1).max(50).optional()
      })
      .parse(request.query);

    return getOrganizationActivity(query.mailboxId, query.months ?? 4, query.limit ?? 25);
  });

  app.get("/v1/threads/:threadId", async (request, reply) => {
    const params = z
      .object({
        threadId: z.string().cuid()
      })
      .parse(request.params);

    const thread = await getThreadDetailRecord(params.threadId);

    if (!thread) {
      return reply.status(404).send({
        error: "Thread not found."
      });
    }

    return serializeThreadDetail(thread);
  });

  app.get("/v1/threads/:threadId/assistant", async (request, reply) => {
    const params = z
      .object({
        threadId: z.string().cuid()
      })
      .parse(request.params);

    const thread = await getThreadDetailRecord(params.threadId);

    if (!thread) {
      return reply.status(404).send({
        error: "Thread not found."
      });
    }

    return buildAssistantPayload(thread);
  });

  app.post("/v1/threads/:threadId/actions/mark-read", async (request, reply) => {
    const params = z
      .object({
        threadId: z.string().cuid()
      })
      .parse(request.params);

    const existing = await requireThreadStatus(params.threadId, reply);
    if (!existing) {
      return;
    }

    await prisma.$transaction([
      prisma.message.updateMany({
        where: {
          threadId: params.threadId,
          isRead: false
        },
        data: {
          isRead: true
        }
      }),
      prisma.thread.update({
        where: {
          id: params.threadId
        },
        data: {
          unreadCount: 0
        }
      })
    ]);

    const thread = await requireThreadStatus(params.threadId, reply);
    if (!thread) {
      return;
    }

    return {
      thread: serializeThreadStatus(thread)
    };
  });

  app.post("/v1/threads/:threadId/actions/mark-unread", async (request, reply) => {
    const params = z
      .object({
        threadId: z.string().cuid()
      })
      .parse(request.params);

    const detail = await getThreadDetailRecord(params.threadId);
    if (!detail) {
      return reply.status(404).send({
        error: "Thread not found."
      });
    }

    await prisma.$transaction([
      prisma.message.updateMany({
        where: {
          threadId: params.threadId,
          isRead: true
        },
        data: {
          isRead: false
        }
      }),
      prisma.thread.update({
        where: {
          id: params.threadId
        },
        data: {
          unreadCount: detail.messages.length
        }
      })
    ]);

    const thread = await requireThreadStatus(params.threadId, reply);
    if (!thread) {
      return;
    }

    return {
      thread: serializeThreadStatus(thread)
    };
  });

  app.post("/v1/threads/:threadId/actions/archive", async (request, reply) => {
    const params = z
      .object({
        threadId: z.string().cuid()
      })
      .parse(request.params);

    const existing = await requireThreadStatus(params.threadId, reply);
    if (!existing) {
      return;
    }

    await prisma.thread.update({
      where: {
        id: params.threadId
      },
      data: {
        archivedAt: new Date()
      }
    });

    const thread = await requireThreadStatus(params.threadId, reply);
    if (!thread) {
      return;
    }

    return {
      thread: serializeThreadStatus(thread)
    };
  });

  app.post("/v1/threads/:threadId/actions/unarchive", async (request, reply) => {
    const params = z
      .object({
        threadId: z.string().cuid()
      })
      .parse(request.params);

    const existing = await requireThreadStatus(params.threadId, reply);
    if (!existing) {
      return;
    }

    await prisma.thread.update({
      where: {
        id: params.threadId
      },
      data: {
        archivedAt: null
      }
    });

    const thread = await requireThreadStatus(params.threadId, reply);
    if (!thread) {
      return;
    }

    return {
      thread: serializeThreadStatus(thread)
    };
  });

  app.post("/v1/threads/:threadId/actions/follow-up", async (request, reply) => {
    const params = z
      .object({
        threadId: z.string().cuid()
      })
      .parse(request.params);
    const body = z
      .object({
        dueAt: z.coerce.date(),
        title: z.string().trim().min(1).max(160).optional(),
        note: z.string().trim().max(1000).optional()
      })
      .parse(request.body);

    const thread = await getThreadDetailRecord(params.threadId);
    if (!thread) {
      return reply.status(404).send({
        error: "Thread not found."
      });
    }

    const primaryExternalParticipant = thread.participantsExpanded.find((participant) => !participant.isMailbox) ?? null;
    const followUpTask = await prisma.followUpTask.create({
      data: {
        threadId: thread.id,
        mailboxId: thread.mailboxId,
        organizationId: primaryExternalParticipant?.organizationId ?? null,
        contactId: primaryExternalParticipant?.contactId ?? null,
        source: FollowUpTaskSource.MANUAL,
        title: body.title ?? `Follow up on ${thread.subject || "thread"}`,
        note: body.note?.trim() || null,
        dueAt: body.dueAt,
        status: FollowUpTaskStatus.PENDING
      }
    });

    const updatedThread = await requireThreadStatus(params.threadId, reply);
    if (!updatedThread) {
      return;
    }

    return {
      thread: serializeThreadStatus(updatedThread),
      followUpTask: serializePendingFollowUp(followUpTask)
    };
  });
}
