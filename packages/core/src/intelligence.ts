import {
  FollowUpTaskSource,
  FollowUpTaskStatus,
  MailboxKind,
  MailboxRole,
  MessageCategoryLabel,
  MessageCategorySource,
  OrganizationKind,
  ReplyStateStatus
} from "@prisma/client";

import { prisma } from "./db";

const TEAM_SHARED_MAILBOX = "hey@razzinteractive.com";
const TEAM_INTERNAL_DOMAIN = "razzinteractive.com";

type RecipientSummary = {
  address: string;
  name: string;
};

type ThreadWithMessages = Awaited<ReturnType<typeof loadThreadForIntelligence>>;

function normalizeAddress(address?: string | null) {
  return address?.trim().toLowerCase() ?? "";
}

function normalizeName(name?: string | null) {
  return (name?.trim() || "").replace(/\s+/g, " ");
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function domainFromAddress(address?: string | null) {
  const normalized = normalizeAddress(address);
  const [, domain = ""] = normalized.split("@");
  return domain;
}

function titleize(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function organizationNameFromDomain(domain: string) {
  const stem = domain.split(".")[0] ?? domain;

  if (domain === TEAM_INTERNAL_DOMAIN) {
    return "Razz Interactive";
  }

  return titleize(stem.replace(/[_-]+/g, " "));
}

export function inferMailboxRole(emailAddress: string, kind: MailboxKind) {
  if (emailAddress === TEAM_SHARED_MAILBOX) {
    return MailboxRole.TEAM;
  }

  return kind === MailboxKind.SHARED ? MailboxRole.SHARED : MailboxRole.PERSONAL;
}

function endOfDay(value: Date) {
  const result = new Date(value);
  result.setHours(23, 59, 59, 999);
  return result;
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function hasExternalParticipants(
  thread: NonNullable<ThreadWithMessages>,
  internalAddresses: Set<string>,
  internalDomains: Set<string>
) {
  return thread.messages.some((message) => {
    const participants = [
      ...(message.fromAddress
        ? [
            {
              address: message.fromAddress,
              name: message.fromName ?? message.fromAddress
            }
          ]
        : []),
      ...((message.toRecipients as RecipientSummary[]) ?? []),
      ...((message.ccRecipients as RecipientSummary[]) ?? [])
    ];

    return participants.some((participant) => !isInternalParticipant(participant.address, internalAddresses, internalDomains));
  });
}

function isInternalParticipant(
  emailAddress: string,
  internalAddresses: Set<string>,
  internalDomains: Set<string>
) {
  const normalized = normalizeAddress(emailAddress);
  const domain = domainFromAddress(normalized);
  return (
    normalized === TEAM_SHARED_MAILBOX ||
    internalAddresses.has(normalized) ||
    internalDomains.has(domain)
  );
}

function extractRoleTitle(displayName: string) {
  const match = displayName.match(/\b(ceo|cto|cfo|founder|director|manager|producer|designer|developer|account manager|coordinator)\b/i);
  return match?.[0] ? titleize(match[0]) : null;
}

async function ensureOrganization(input: {
  name: string;
  primaryDomain?: string;
  kind: OrganizationKind;
}) {
  const normalizedName = normalizeKey(input.name) || normalizeKey(input.primaryDomain ?? "organization");
  const organizationOrConditions = [
    ...(input.primaryDomain
      ? [
          {
            primaryDomain: input.primaryDomain
          }
        ]
      : []),
    {
      normalizedName
    }
  ];
  const existing = await prisma.organization.findFirst({
    where: {
      OR: organizationOrConditions
    }
  });

  if (existing) {
    return prisma.organization.update({
      where: { id: existing.id },
      data: {
        name: existing.name || input.name,
        primaryDomain: existing.primaryDomain ?? input.primaryDomain,
        kind: existing.kind === OrganizationKind.UNKNOWN ? input.kind : existing.kind
      }
    });
  }

  return prisma.organization.create({
    data: {
      name: input.name,
      normalizedName,
      primaryDomain: input.primaryDomain,
      kind: input.kind
    }
  });
}

async function ensureContact(input: {
  emailAddress: string;
  displayName: string;
  organizationId?: string;
  isMailboxOwner: boolean;
  lastSeenAt: Date;
}) {
  const normalizedEmail = normalizeAddress(input.emailAddress);
  const normalizedDisplayName = normalizeName(input.displayName) || normalizedEmail;
  const roleTitle = extractRoleTitle(normalizedDisplayName);
  const existing = await prisma.contactEmailAddress.findUnique({
    where: {
      emailAddress: normalizedEmail
    },
    include: {
      contact: true
    }
  });

  if (existing) {
    const contact = await prisma.contact.update({
      where: {
        id: existing.contactId
      },
      data: {
        displayName:
          existing.contact.displayName === existing.emailAddress
            ? normalizedDisplayName
            : existing.contact.displayName,
        normalizedName: normalizeKey(normalizedDisplayName),
        roleTitle: existing.contact.roleTitle ?? roleTitle,
        organizationId: existing.contact.organizationId ?? input.organizationId,
        isMailboxOwner: existing.contact.isMailboxOwner || input.isMailboxOwner,
        lastSeenAt: input.lastSeenAt
      }
    });

    await prisma.contactEmailAddress.update({
      where: {
        id: existing.id
      },
      data: {
        domain: domainFromAddress(normalizedEmail),
        isPrimary: true
      }
    });

    return contact;
  }

  return prisma.contact.create({
    data: {
      displayName: normalizedDisplayName,
      normalizedName: normalizeKey(normalizedDisplayName),
      roleTitle,
      organizationId: input.organizationId,
      isMailboxOwner: input.isMailboxOwner,
      lastSeenAt: input.lastSeenAt,
      emailAddresses: {
        create: {
          emailAddress: normalizedEmail,
          domain: domainFromAddress(normalizedEmail),
          isPrimary: true
        }
      }
    }
  });
}

function categoryFromContent(params: {
  mailboxRole: MailboxRole;
  organizationKind: OrganizationKind;
  fromAddress: string | null;
  subject: string;
  bodyText: string;
  internal: boolean;
}) {
  const subject = params.subject.toLowerCase();
  const body = params.bodyText.toLowerCase();
  const combined = `${subject} ${body}`;
  const localPart = normalizeAddress(params.fromAddress).split("@")[0] ?? "";

  if (params.internal || params.organizationKind === OrganizationKind.INTERNAL) {
    return {
      label: MessageCategoryLabel.INTERNAL,
      confidence: 0.98,
      source: MessageCategorySource.DOMAIN
    };
  }

  if (/(newsletter|digest|unsubscribe|mailing list)/.test(combined)) {
    return {
      label: MessageCategoryLabel.NEWSLETTER,
      confidence: 0.94,
      source: MessageCategorySource.HEURISTIC
    };
  }

  if (/(no-?reply|noreply|notification|alerts?|updates?)/.test(localPart) || /(automated|system generated|do not reply)/.test(combined)) {
    return {
      label: MessageCategoryLabel.NOTIFICATION,
      confidence: 0.92,
      source: MessageCategorySource.DOMAIN
    };
  }

  if (/(invoice|billing|receipt|payment|past due|wire|remittance)/.test(combined)) {
    return {
      label: MessageCategoryLabel.BILLING,
      confidence: 0.88,
      source: MessageCategorySource.HEURISTIC
    };
  }

  if (/(ticket|support|help desk|helpdesk|case #|incident)/.test(combined)) {
    return {
      label: MessageCategoryLabel.SUPPORT,
      confidence: 0.84,
      source: MessageCategorySource.HEURISTIC
    };
  }

  if (params.organizationKind === OrganizationKind.LEAD || /(intro|proposal|quote|estimate|rfp|project inquiry|interested in)/.test(combined)) {
    return {
      label: MessageCategoryLabel.LEAD,
      confidence: 0.78,
      source: MessageCategorySource.HEURISTIC
    };
  }

  if (params.organizationKind === OrganizationKind.VENDOR || /(renewal|subscription|contract|procurement)/.test(combined)) {
    return {
      label: MessageCategoryLabel.VENDOR,
      confidence: 0.68,
      source: MessageCategorySource.HEURISTIC
    };
  }

  if (params.mailboxRole === MailboxRole.TEAM || params.mailboxRole === MailboxRole.SHARED) {
    return {
      label: MessageCategoryLabel.CLIENT,
      confidence: 0.62,
      source: MessageCategorySource.DOMAIN
    };
  }

  return {
    label: MessageCategoryLabel.CLIENT,
    confidence: 0.54,
    source: MessageCategorySource.HEURISTIC
  };
}

async function loadThreadForIntelligence(threadId: string) {
  return prisma.thread.findUnique({
    where: {
      id: threadId
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
}

async function resolveInternalSets() {
  const mailboxes = await prisma.mailbox.findMany({
    select: {
      id: true,
      emailAddress: true
    }
  });
  const internalAddresses = new Set(mailboxes.map((mailbox) => normalizeAddress(mailbox.emailAddress)));
  internalAddresses.add(TEAM_SHARED_MAILBOX);
  const internalDomains = new Set(
    mailboxes.map((mailbox) => domainFromAddress(mailbox.emailAddress)).filter(Boolean)
  );
  internalDomains.add(TEAM_INTERNAL_DOMAIN);

  return {
    mailboxes,
    internalAddresses,
    internalDomains
  };
}

async function syncMailboxOwnership(
  mailboxId: string,
  emailAddress: string,
  displayName: string,
  kind: MailboxKind,
  internalDomains: Set<string>
) {
  const normalizedEmail = normalizeAddress(emailAddress);
  const domain = domainFromAddress(normalizedEmail);
  const role = inferMailboxRole(normalizedEmail, kind);
  const organizationKind = internalDomains.has(domain) ? OrganizationKind.INTERNAL : OrganizationKind.UNKNOWN;
  const organization = domain
    ? await ensureOrganization({
        name: organizationNameFromDomain(domain),
        primaryDomain: domain,
        kind: organizationKind
      })
    : null;

  const contact =
    role === MailboxRole.PERSONAL
      ? await ensureContact({
          emailAddress: normalizedEmail,
          displayName: displayName || normalizedEmail,
          organizationId: organization?.id,
          isMailboxOwner: true,
          lastSeenAt: new Date()
        })
      : null;

  await prisma.mailbox.update({
    where: {
      id: mailboxId
    },
    data: {
      role,
      ownerOrganizationId: organization?.id ?? null,
      ownerContactId: contact?.id ?? null
    }
  });
}

async function syncParticipants(
  thread: NonNullable<ThreadWithMessages>,
  internalAddresses: Set<string>,
  internalDomains: Set<string>
) {
  const participantMap = new Map<
    string,
    {
      address: string;
      displayName: string;
      firstSeenAt: Date;
      lastSeenAt: Date;
      isMailbox: boolean;
      isSharedMailbox: boolean;
      organizationKind: OrganizationKind;
    }
  >();

  for (const message of thread.messages) {
    const participants: Array<RecipientSummary> = [
      ...(message.fromAddress
        ? [
            {
              address: message.fromAddress,
              name: message.fromName ?? message.fromAddress
            }
          ]
        : []),
      ...((message.toRecipients as RecipientSummary[]) ?? []),
      ...((message.ccRecipients as RecipientSummary[]) ?? [])
    ];

    for (const participant of participants) {
      const address = normalizeAddress(participant.address);
      if (!address) {
        continue;
      }

      const existing = participantMap.get(address);
      const isMailbox = internalAddresses.has(address);
      const next = {
        address,
        displayName: normalizeName(participant.name) || address,
        firstSeenAt: existing?.firstSeenAt ?? message.receivedAt,
        lastSeenAt: message.receivedAt,
        isMailbox,
        isSharedMailbox:
          address === TEAM_SHARED_MAILBOX ||
          (address === normalizeAddress(thread.mailbox.emailAddress) && thread.mailbox.kind === MailboxKind.SHARED),
        organizationKind: isInternalParticipant(address, internalAddresses, internalDomains)
          ? OrganizationKind.INTERNAL
          : OrganizationKind.UNKNOWN
      };

      participantMap.set(address, existing ? { ...existing, ...next, firstSeenAt: existing.firstSeenAt } : next);
    }
  }

  for (const participant of participantMap.values()) {
    const domain = domainFromAddress(participant.address);
    const organization = domain
      ? await ensureOrganization({
          name: organizationNameFromDomain(domain),
          primaryDomain: domain,
          kind: participant.organizationKind
        })
      : null;

    const contact = await ensureContact({
      emailAddress: participant.address,
      displayName: participant.displayName,
      organizationId: organization?.id,
      isMailboxOwner: participant.address === normalizeAddress(thread.mailbox.emailAddress),
      lastSeenAt: participant.lastSeenAt
    });
    await prisma.threadParticipant.upsert({
      where: {
        threadId_emailAddress: {
          threadId: thread.id,
          emailAddress: participant.address
        }
      },
      update: {
        displayName: participant.displayName,
        contactId: contact.id,
        organizationId: organization?.id ?? null,
        isMailbox: participant.isMailbox,
        isSharedMailbox: participant.isSharedMailbox,
        firstSeenAt: participant.firstSeenAt,
        lastSeenAt: participant.lastSeenAt
      },
      create: {
        threadId: thread.id,
        contactId: contact.id,
        organizationId: organization?.id ?? null,
        emailAddress: participant.address,
        displayName: participant.displayName,
        isMailbox: participant.isMailbox,
        isSharedMailbox: participant.isSharedMailbox,
        firstSeenAt: participant.firstSeenAt,
        lastSeenAt: participant.lastSeenAt
      }
    });
  }

  await prisma.threadParticipant.deleteMany({
    where: {
      threadId: thread.id,
      emailAddress: {
        notIn: Array.from(participantMap.keys())
      }
    }
  });
}

async function syncMessageCategories(
  thread: NonNullable<ThreadWithMessages>,
  internalAddresses: Set<string>,
  internalDomains: Set<string>
) {
  for (const message of thread.messages) {
    const domain = domainFromAddress(message.fromAddress);
    const organization = domain
      ? await prisma.organization.findFirst({
          where: {
            primaryDomain: domain
          }
        })
      : null;
    const category = categoryFromContent({
      mailboxRole: thread.mailbox.role,
      organizationKind: organization?.kind ?? OrganizationKind.UNKNOWN,
      fromAddress: message.fromAddress,
      subject: message.subject,
      bodyText: message.bodyText,
      internal: isInternalParticipant(message.fromAddress ?? "", internalAddresses, internalDomains)
    });
    const existing = await prisma.messageCategory.findUnique({
      where: {
        messageId: message.id
      }
    });

    if (existing?.isUserOverride) {
      continue;
    }

    await prisma.messageCategory.upsert({
      where: {
        messageId: message.id
      },
      update: {
        threadId: thread.id,
        organizationId: organization?.id ?? null,
        label: category.label,
        confidence: category.confidence,
        source: category.source
      },
      create: {
        messageId: message.id,
        threadId: thread.id,
        organizationId: organization?.id ?? null,
        label: category.label,
        confidence: category.confidence,
        source: category.source
      }
    });
  }
}

function computeReplyState(
  thread: NonNullable<ThreadWithMessages>,
  internalAddresses: Set<string>,
  internalDomains: Set<string>
) {
  const externalMessages = thread.messages.filter(
    (message) => !isInternalParticipant(message.fromAddress ?? "", internalAddresses, internalDomains)
  );
  const outboundMessages = thread.messages.filter((message) =>
    isInternalParticipant(message.fromAddress ?? "", internalAddresses, internalDomains)
  );

  const lastMessage = thread.messages[thread.messages.length - 1] ?? null;
  const lastInbound = externalMessages[externalMessages.length - 1] ?? null;
  const lastOutbound = outboundMessages[outboundMessages.length - 1] ?? null;
  const lastOutboundAt = lastOutbound ? lastOutbound.receivedAt : null;

  if (!lastMessage || !hasExternalParticipants(thread, internalAddresses, internalDomains)) {
    return {
      status: ReplyStateStatus.CLOSED_LOOP,
      reason: "Thread only contains internal participants.",
      confidence: 0.98,
      needsReply: false,
      waitingOnThem: false,
      lastInboundAt: lastInbound?.receivedAt ?? null,
      lastOutboundAt: lastOutbound?.receivedAt ?? null,
      replyDueAt: null,
      staleAt: null,
      suggestedFollowUpAt: null,
      isOverdue: false
    };
  }

  const lastWasInbound = !isInternalParticipant(lastMessage.fromAddress ?? "", internalAddresses, internalDomains);
  const combined = `${lastMessage.subject} ${lastMessage.bodyText}`.toLowerCase();

  if (/(thanks|thank you|resolved|all set|closed loop|no worries)/.test(combined) && lastWasInbound) {
    return {
      status: ReplyStateStatus.CLOSED_LOOP,
      reason: "Latest inbound message looks like a closeout rather than a request.",
      confidence: 0.7,
      needsReply: false,
      waitingOnThem: false,
      lastInboundAt: lastInbound?.receivedAt ?? null,
      lastOutboundAt: lastOutbound?.receivedAt ?? null,
      replyDueAt: null,
      staleAt: null,
      suggestedFollowUpAt: null,
      isOverdue: false
    };
  }

  if (lastWasInbound) {
    const replyDueAt = endOfDay(lastMessage.receivedAt);
    const staleAt = addDays(lastMessage.receivedAt, 2);
    const isOverdue = Date.now() > replyDueAt.getTime();

    return {
      status: ReplyStateStatus.NEEDS_REPLY,
      reason: "Latest external message does not have a newer reply from your side.",
      confidence: 0.86,
      needsReply: true,
      waitingOnThem: false,
      lastInboundAt: lastInbound?.receivedAt ?? null,
      lastOutboundAt: lastOutbound?.receivedAt ?? null,
      replyDueAt,
      staleAt,
      suggestedFollowUpAt: null,
      isOverdue
    };
  }

  if (lastOutbound) {
    const outboundReceivedAt = lastOutbound.receivedAt;
    const suggestedFollowUpAt = addDays(outboundReceivedAt, 5);

    return {
      status: ReplyStateStatus.WAITING_ON_THEM,
      reason: "You replied most recently. Follow up if they stay silent.",
      confidence: 0.78,
      needsReply: false,
      waitingOnThem: true,
      lastInboundAt: lastInbound?.receivedAt ?? null,
      lastOutboundAt: outboundReceivedAt,
      replyDueAt: null,
      staleAt: addDays(outboundReceivedAt, 2),
      suggestedFollowUpAt,
      isOverdue: Date.now() > suggestedFollowUpAt.getTime()
    };
  }

  return {
    status: ReplyStateStatus.CLOSED_LOOP,
    reason: "No open reply obligation was detected.",
    confidence: 0.5,
    needsReply: false,
    waitingOnThem: false,
    lastInboundAt: lastInbound?.receivedAt ?? null,
    lastOutboundAt,
    replyDueAt: null,
    staleAt: null,
    suggestedFollowUpAt: null,
    isOverdue: false
  };
}

async function syncReplyStateAndFollowUp(
  thread: NonNullable<ThreadWithMessages>,
  internalAddresses: Set<string>,
  internalDomains: Set<string>
) {
  const replyState = computeReplyState(thread, internalAddresses, internalDomains);

  await prisma.replyState.upsert({
    where: {
      threadId: thread.id
    },
    update: {
      mailboxId: thread.mailboxId,
      ...replyState
    },
    create: {
      threadId: thread.id,
      mailboxId: thread.mailboxId,
      ...replyState
    }
  });

  const externalParticipant = await prisma.threadParticipant.findFirst({
    where: {
      threadId: thread.id,
      isMailbox: false
    },
    orderBy: {
      lastSeenAt: "desc"
    }
  });

  if (replyState.status === ReplyStateStatus.WAITING_ON_THEM && replyState.suggestedFollowUpAt) {
    const title = `Follow up: ${thread.subject}`;
    const existing = await prisma.followUpTask.findFirst({
      where: {
        threadId: thread.id,
        source: FollowUpTaskSource.AUTO,
        status: FollowUpTaskStatus.PENDING
      }
    });

    if (existing) {
      await prisma.followUpTask.update({
        where: {
          id: existing.id
        },
        data: {
          mailboxId: thread.mailboxId,
          organizationId: externalParticipant?.organizationId ?? null,
          contactId: externalParticipant?.contactId ?? null,
          title,
          note: replyState.reason,
          dueAt: replyState.suggestedFollowUpAt
        }
      });
    } else {
      await prisma.followUpTask.create({
        data: {
          threadId: thread.id,
          mailboxId: thread.mailboxId,
          organizationId: externalParticipant?.organizationId ?? null,
          contactId: externalParticipant?.contactId ?? null,
          source: FollowUpTaskSource.AUTO,
          status: FollowUpTaskStatus.PENDING,
          title,
          note: replyState.reason,
          dueAt: replyState.suggestedFollowUpAt
        }
      });
    }
  } else {
    await prisma.followUpTask.updateMany({
      where: {
        threadId: thread.id,
        source: FollowUpTaskSource.AUTO,
        status: FollowUpTaskStatus.PENDING
      },
      data: {
        status: FollowUpTaskStatus.CANCELED,
        completedAt: new Date()
      }
    });
  }
}

export async function applyThreadIntelligence(threadId: string) {
  const thread = await loadThreadForIntelligence(threadId);
  if (!thread) {
    return;
  }

  const { internalAddresses, internalDomains } = await resolveInternalSets();

  await syncMailboxOwnership(
    thread.mailbox.id,
    thread.mailbox.emailAddress,
    thread.mailbox.displayName,
    thread.mailbox.kind,
    internalDomains
  );

  const refreshedThread = await loadThreadForIntelligence(threadId);
  if (!refreshedThread) {
    return;
  }

  await syncParticipants(refreshedThread, internalAddresses, internalDomains);
  await syncMessageCategories(refreshedThread, internalAddresses, internalDomains);
  await syncReplyStateAndFollowUp(refreshedThread, internalAddresses, internalDomains);
}

export async function rebuildIntelligence(mailboxId?: string) {
  const threads = await prisma.thread.findMany({
    where: mailboxId
      ? {
          mailboxId
        }
      : undefined,
    select: {
      id: true
    }
  });

  for (const thread of threads) {
    await applyThreadIntelligence(thread.id);
  }
}
