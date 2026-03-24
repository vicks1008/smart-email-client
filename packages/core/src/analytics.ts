import { MessageCategoryLabel, OrganizationKind } from "@prisma/client";

import { prisma } from "./db";

type OrganizationActivityInput = {
  mailboxId?: string;
  months?: number;
  limit?: number;
};

export type OrganizationActivityRequest = OrganizationActivityInput;

type OrganizationParticipant = {
  emailAddress: string;
  isMailbox: boolean;
  organizationId: string | null;
  contactId: string | null;
  organization: {
    id: string;
    name: string;
    kind: OrganizationKind;
    primaryDomain: string | null;
  } | null;
};

type ThreadForActivity = Awaited<ReturnType<typeof loadThreadsForActivity>>[number];

export type OrganizationActivityRecord = {
  id: string;
  name: string;
  primaryDomain: string | null;
  kind: OrganizationKind;
  inferredKind: OrganizationKind;
  dominantCategory: MessageCategoryLabel | null;
  threadCount: number;
  messageCount: number;
  inboundMessageCount: number;
  outboundMessageCount: number;
  uniqueContactCount: number;
  openNeedsReplyCount: number;
  waitingOnThemCount: number;
  activityShare: number;
  lastMessageAt: string | null;
};

export type OrganizationActivityItem = OrganizationActivityRecord;

export type OrganizationActivityAnalytics = {
  window: {
    months: number;
    startAt: string;
    endAt: string;
  };
  summary: {
    organizations: number;
    totalMessages: number;
    totalThreads: number;
  };
  organizations: OrganizationActivityRecord[];
};

export type OrganizationActivityResult = OrganizationActivityAnalytics;

function normalizeAddress(address?: string | null) {
  return address?.trim().toLowerCase() ?? "";
}

function domainFromAddress(address?: string | null) {
  const normalized = normalizeAddress(address);
  const [, domain = ""] = normalized.split("@");
  return domain;
}

function subtractMonths(value: Date, months: number) {
  const result = new Date(value);
  result.setMonth(result.getMonth() - months);
  return result;
}

function inferredKindFromCategory(label: MessageCategoryLabel | null) {
  switch (label) {
    case MessageCategoryLabel.CLIENT:
      return OrganizationKind.CLIENT;
    case MessageCategoryLabel.LEAD:
      return OrganizationKind.LEAD;
    case MessageCategoryLabel.VENDOR:
      return OrganizationKind.VENDOR;
    case MessageCategoryLabel.BILLING:
    case MessageCategoryLabel.SUPPORT:
    case MessageCategoryLabel.NEWSLETTER:
    case MessageCategoryLabel.NOTIFICATION:
      return OrganizationKind.CLIENT;
    case MessageCategoryLabel.INTERNAL:
      return OrganizationKind.INTERNAL;
    default:
      return OrganizationKind.CLIENT;
  }
}

function shouldIncludeOrganization(kind: OrganizationKind) {
  return kind === OrganizationKind.CLIENT;
}

async function loadThreadsForActivity(startAt: Date, mailboxId?: string) {
  return prisma.thread.findMany({
    where: {
      ...(mailboxId ? { mailboxId } : {}),
      lastMessageAt: {
        gte: startAt
      }
    },
    include: {
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
          receivedAt: "asc"
        },
        include: {
          category: true
        }
      }
    }
  });
}

async function resolveInternalSets() {
  const mailboxes = await prisma.mailbox.findMany({
    select: {
      emailAddress: true
    }
  });

  const internalAddresses = new Set(mailboxes.map((mailbox) => normalizeAddress(mailbox.emailAddress)).filter(Boolean));
  const internalDomains = new Set(mailboxes.map((mailbox) => domainFromAddress(mailbox.emailAddress)).filter(Boolean));

  return {
    internalAddresses,
    internalDomains
  };
}

function isInternalAddress(address: string | null | undefined, internalAddresses: Set<string>, internalDomains: Set<string>) {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return false;
  }

  return internalAddresses.has(normalized) || internalDomains.has(domainFromAddress(normalized));
}

function getPrimaryExternalParticipant(thread: ThreadForActivity) {
  return [...thread.participantsExpanded]
    .filter((participant) => !participant.isMailbox && participant.organization)
    .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())[0] ?? null;
}

function getSenderOrganization(thread: ThreadForActivity, fromAddress: string | null) {
  const normalizedFrom = normalizeAddress(fromAddress);
  if (!normalizedFrom) {
    return null;
  }

  return (
    thread.participantsExpanded.find((participant) => normalizeAddress(participant.emailAddress) === normalizedFrom)?.organization ??
    null
  );
}

function dominantCategoryFromCounts(categoryCounts: Map<MessageCategoryLabel, number>) {
  let winner: MessageCategoryLabel | null = null;
  let winnerCount = -1;

  for (const [label, count] of categoryCounts) {
    if (count > winnerCount) {
      winner = label;
      winnerCount = count;
    }
  }

  return winner;
}

export async function getOrganizationActivity(input: OrganizationActivityInput = {}): Promise<OrganizationActivityAnalytics> {
  const months = Math.max(1, Math.min(input.months ?? 4, 12));
  const limit = Math.max(1, Math.min(input.limit ?? 12, 50));
  const endAt = new Date();
  const startAt = subtractMonths(endAt, months);
  const [{ internalAddresses, internalDomains }, threads] = await Promise.all([
    resolveInternalSets(),
    loadThreadsForActivity(startAt, input.mailboxId)
  ]);

  const aggregates = new Map<
    string,
    {
      id: string;
      name: string;
      primaryDomain: string | null;
      kind: OrganizationKind;
      threadIds: Set<string>;
      contactIds: Set<string>;
      messageCount: number;
      inboundMessageCount: number;
      outboundMessageCount: number;
      openNeedsReplyCount: number;
      waitingOnThemCount: number;
      lastMessageAt: Date | null;
      categoryCounts: Map<MessageCategoryLabel, number>;
    }
  >();

  for (const thread of threads) {
    const primaryExternalParticipant = getPrimaryExternalParticipant(thread);

    for (const message of thread.messages) {
      const messageIsInbound = !isInternalAddress(message.fromAddress, internalAddresses, internalDomains);
      const resolvedOrganization =
        (messageIsInbound ? getSenderOrganization(thread, message.fromAddress) : null) ??
        primaryExternalParticipant?.organization ??
        null;

      if (!resolvedOrganization) {
        continue;
      }

      const organizationId = resolvedOrganization.id;
      const aggregate = aggregates.get(organizationId) ?? {
        id: resolvedOrganization.id,
        name: resolvedOrganization.name,
        primaryDomain: resolvedOrganization.primaryDomain,
        kind: resolvedOrganization.kind,
        threadIds: new Set<string>(),
        contactIds: new Set<string>(),
        messageCount: 0,
        inboundMessageCount: 0,
        outboundMessageCount: 0,
        openNeedsReplyCount: 0,
        waitingOnThemCount: 0,
        lastMessageAt: null,
        categoryCounts: new Map<MessageCategoryLabel, number>()
      };

      aggregate.threadIds.add(thread.id);
      aggregate.messageCount += 1;
      if (messageIsInbound) {
        aggregate.inboundMessageCount += 1;
      } else {
        aggregate.outboundMessageCount += 1;
      }

      if (!aggregate.lastMessageAt || message.receivedAt.getTime() > aggregate.lastMessageAt.getTime()) {
        aggregate.lastMessageAt = message.receivedAt;
      }

      if (message.category?.label) {
        aggregate.categoryCounts.set(message.category.label, (aggregate.categoryCounts.get(message.category.label) ?? 0) + 1);
      }

      for (const participant of thread.participantsExpanded as OrganizationParticipant[]) {
        if (!participant.isMailbox && participant.organizationId === organizationId && participant.contactId) {
          aggregate.contactIds.add(participant.contactId);
        }
      }

      if (thread.replyState?.needsReply) {
        aggregate.openNeedsReplyCount = aggregate.openNeedsReplyCount || 1;
      }

      if (thread.replyState?.waitingOnThem) {
        aggregate.waitingOnThemCount = aggregate.waitingOnThemCount || 1;
      }

      aggregates.set(organizationId, aggregate);
    }
  }

  const records = Array.from(aggregates.values())
    .map((aggregate) => {
      const dominantCategory = dominantCategoryFromCounts(aggregate.categoryCounts);
      const inferredKind =
        aggregate.kind === OrganizationKind.UNKNOWN ? inferredKindFromCategory(dominantCategory) : aggregate.kind;

      return {
        id: aggregate.id,
        name: aggregate.name,
        primaryDomain: aggregate.primaryDomain,
        kind: aggregate.kind,
        inferredKind,
        dominantCategory,
        threadCount: aggregate.threadIds.size,
        messageCount: aggregate.messageCount,
        inboundMessageCount: aggregate.inboundMessageCount,
        outboundMessageCount: aggregate.outboundMessageCount,
        uniqueContactCount: aggregate.contactIds.size,
        openNeedsReplyCount: aggregate.openNeedsReplyCount,
        waitingOnThemCount: aggregate.waitingOnThemCount,
        lastMessageAt: aggregate.lastMessageAt?.toISOString() ?? null
      };
    })
    .filter((record) => shouldIncludeOrganization(record.inferredKind))
    .sort((left, right) => {
      if (right.messageCount !== left.messageCount) {
        return right.messageCount - left.messageCount;
      }

      if (right.threadCount !== left.threadCount) {
        return right.threadCount - left.threadCount;
      }

      return (right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : 0) - (left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0);
    });

  const totalMessages = records.reduce((sum, record) => sum + record.messageCount, 0);
  const organizations = records.slice(0, limit).map((record) => ({
    ...record,
    activityShare: totalMessages > 0 ? Number((record.messageCount / totalMessages).toFixed(4)) : 0
  }));

  return {
    window: {
      months,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString()
    },
    summary: {
      organizations: records.length,
      totalMessages,
      totalThreads: records.reduce((sum, record) => sum + record.threadCount, 0)
    },
    organizations
  };
}

export const getOrganizationActivityAnalytics = getOrganizationActivity;
