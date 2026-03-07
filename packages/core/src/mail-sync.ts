import {
  AccountProvider,
  AccountStatus,
  MailboxKind,
  SyncJobStatus,
  SyncTrigger,
  type Mailbox
} from "@prisma/client";

import { prisma } from "./db";
import { getEnv, hasMicrosoftOAuthConfig } from "./env";
import { applyThreadIntelligence, inferMailboxRole } from "./intelligence";
import {
  getMailboxResourcePath,
  getMicrosoftProfile,
  getPrimaryMailboxIdentity,
  graphFetch,
  refreshMicrosoftAccessToken,
  type GraphMessage,
  type GraphRecipient
} from "./microsoft";

type MailboxSummaryInput = {
  emailAddress: string;
  displayName?: string | null;
  kind?: MailboxKind;
};

type GraphMessagesResponse = {
  value: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

type RecipientSummary = {
  address: string;
  name: string;
};

export type NormalizedMessage = {
  externalMessageId: string;
  externalConversationId: string;
  internetMessageId?: string | null;
  subject: string;
  fromName?: string | null;
  fromAddress?: string | null;
  toRecipients: RecipientSummary[];
  ccRecipients: RecipientSummary[];
  receivedAt: Date;
  sentAt?: Date | null;
  bodyPreview: string;
  bodyText: string;
  bodyHtml?: string | null;
  webLink?: string | null;
  importance?: string | null;
  isRead?: boolean;
  hasAttachments?: boolean;
};

function normalizeRecipients(recipients: GraphRecipient[] | null | undefined) {
  return (recipients ?? [])
    .map((recipient) => recipient.emailAddress)
    .filter((value): value is NonNullable<typeof value> => Boolean(value?.address))
    .map((recipient) => ({
      address: recipient.address ?? "",
      name: recipient.name ?? recipient.address ?? ""
    }));
}

function recipientKey(recipient: RecipientSummary) {
  return `${recipient.name}|${recipient.address}`;
}

function uniqueRecipients(recipients: RecipientSummary[]) {
  return Array.from(new Map(recipients.map((recipient) => [recipientKey(recipient), recipient])).values());
}

function htmlToText(html: string | null | undefined) {
  return (html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export async function registerMailbox(accountId: string, input: MailboxSummaryInput) {
  const normalizedEmailAddress = input.emailAddress.trim().toLowerCase();
  const externalId =
    input.kind === MailboxKind.SHARED ? `shared:${normalizedEmailAddress}` : "primary";

  return prisma.mailbox.upsert({
    where: {
      accountId_externalId: {
        accountId,
        externalId
      }
    },
    update: {
      displayName: input.displayName ?? normalizedEmailAddress,
      emailAddress: normalizedEmailAddress,
      kind: input.kind ?? MailboxKind.PRIMARY,
      role: inferMailboxRole(normalizedEmailAddress, input.kind ?? MailboxKind.PRIMARY)
    },
    create: {
      accountId,
      externalId,
      emailAddress: normalizedEmailAddress,
      displayName: input.displayName ?? normalizedEmailAddress,
      kind: input.kind ?? MailboxKind.PRIMARY,
      role: inferMailboxRole(normalizedEmailAddress, input.kind ?? MailboxKind.PRIMARY)
    }
  });
}

export async function registerPrimaryMailboxForAccount(accountId: string, accessToken: string) {
  const profile = await getMicrosoftProfile(accessToken);
  return registerMailbox(accountId, getPrimaryMailboxIdentity(profile));
}

export async function ensureFreshAccessToken(accountId: string) {
  const account = await prisma.account.findUnique({
    where: { id: accountId }
  });

  if (!account) {
    throw new Error(`Account ${accountId} was not found.`);
  }

  if (!hasMicrosoftOAuthConfig()) {
    throw new Error("Microsoft OAuth is not configured.");
  }

  const expiresSoon =
    !account.tokenExpiresAt || account.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;

  if (!expiresSoon) {
    if (!account.accessToken) {
      throw new Error(`Account ${account.email} does not have an active access token.`);
    }

    return account.accessToken;
  }

  if (!account.refreshToken) {
    await prisma.account.update({
      where: { id: accountId },
      data: {
        status: AccountStatus.NEEDS_REAUTH
      }
    });
    throw new Error(`Account ${account.email} needs to reconnect Microsoft OAuth.`);
  }

  const refreshed = await refreshMicrosoftAccessToken(account.refreshToken);

  await prisma.account.update({
    where: { id: accountId },
    data: {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? account.refreshToken,
      tokenExpiresAt: refreshed.expiresAt,
      scopes: refreshed.scopes,
      status: AccountStatus.ACTIVE
    }
  });

  return refreshed.accessToken;
}

export async function queueMailboxSync(mailboxId: string, trigger: SyncTrigger) {
  const mailbox = await prisma.mailbox.findUnique({
    where: { id: mailboxId }
  });

  if (!mailbox) {
    throw new Error(`Mailbox ${mailboxId} was not found.`);
  }

  const existingJob = await prisma.syncJob.findFirst({
    where: {
      mailboxId,
      status: {
        in: [SyncJobStatus.QUEUED, SyncJobStatus.IN_PROGRESS]
      }
    }
  });

  if (existingJob) {
    return existingJob;
  }

  return prisma.syncJob.create({
    data: {
      accountId: mailbox.accountId,
      mailboxId,
      trigger
    }
  });
}

export async function queueAccountSync(accountId: string, trigger: SyncTrigger) {
  const mailboxes = await prisma.mailbox.findMany({
    where: {
      accountId
    }
  });

  return Promise.all(mailboxes.map((mailbox) => queueMailboxSync(mailbox.id, trigger)));
}

function threadParticipants(message: GraphMessage) {
  const recipients = uniqueRecipients([
    ...normalizeRecipients(message.toRecipients),
    ...normalizeRecipients(message.ccRecipients),
    ...normalizeRecipients(message.from ? [message.from] : [])
  ]);

  return recipients;
}

function normalizedParticipants(message: Pick<NormalizedMessage, "toRecipients" | "ccRecipients" | "fromName" | "fromAddress">) {
  return uniqueRecipients([
    ...message.toRecipients,
    ...message.ccRecipients,
    ...(message.fromAddress
      ? [
          {
            address: message.fromAddress,
            name: message.fromName ?? message.fromAddress
          }
        ]
      : [])
  ]);
}

export function previewFromText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

export function normalizeGraphMessage(message: GraphMessage): NormalizedMessage {
  const bodyHtml = message.body?.contentType === "html" ? message.body.content ?? "" : null;
  const bodyText = bodyHtml ? htmlToText(bodyHtml) : htmlToText(message.body?.content);

  return {
    externalMessageId: message.id,
    externalConversationId: message.conversationId ?? message.id,
    internetMessageId: message.internetMessageId ?? null,
    subject: message.subject?.trim() || "(no subject)",
    fromName: message.from?.emailAddress?.name ?? null,
    fromAddress: message.from?.emailAddress?.address ?? null,
    toRecipients: normalizeRecipients(message.toRecipients),
    ccRecipients: normalizeRecipients(message.ccRecipients),
    receivedAt: new Date(message.receivedDateTime ?? Date.now()),
    sentAt: message.sentDateTime ? new Date(message.sentDateTime) : null,
    bodyPreview: message.bodyPreview ?? previewFromText(bodyText),
    bodyText,
    bodyHtml,
    webLink: message.webLink ?? null,
    importance: message.importance ?? null,
    isRead: message.isRead ?? false,
    hasAttachments: message.hasAttachments ?? false
  };
}

export async function ingestNormalizedMessage(mailbox: Mailbox, message: NormalizedMessage) {
  const receivedAt = message.receivedAt;
  const subject = message.subject?.trim() || "(no subject)";
  const participants = normalizedParticipants(message);

  const thread = await prisma.thread.upsert({
    where: {
      mailboxId_externalConversationId: {
        mailboxId: mailbox.id,
        externalConversationId: message.externalConversationId
      }
    },
    update: {
      subject,
      participants: participants,
      lastMessageAt: receivedAt
    },
    create: {
      mailboxId: mailbox.id,
      externalConversationId: message.externalConversationId,
      subject,
      participants: participants,
      lastMessageAt: receivedAt
    }
  });

  await prisma.message.upsert({
    where: {
      mailboxId_externalMessageId: {
        mailboxId: mailbox.id,
        externalMessageId: message.externalMessageId
      }
    },
    update: {
      subject,
      fromName: message.fromName ?? null,
      fromAddress: message.fromAddress ?? null,
      toRecipients: message.toRecipients,
      ccRecipients: message.ccRecipients,
      receivedAt,
      sentAt: message.sentAt ?? null,
      bodyPreview: message.bodyPreview,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml ?? null,
      webLink: message.webLink ?? null,
      importance: message.importance ?? null,
      isRead: message.isRead ?? false,
      hasAttachments: message.hasAttachments ?? false,
      internetMessageId: message.internetMessageId ?? null,
      threadId: thread.id
    },
    create: {
      mailboxId: mailbox.id,
      threadId: thread.id,
      externalMessageId: message.externalMessageId,
      subject,
      fromName: message.fromName ?? null,
      fromAddress: message.fromAddress ?? null,
      toRecipients: message.toRecipients,
      ccRecipients: message.ccRecipients,
      receivedAt,
      sentAt: message.sentAt ?? null,
      bodyPreview: message.bodyPreview,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml ?? null,
      webLink: message.webLink ?? null,
      importance: message.importance ?? null,
      isRead: message.isRead ?? false,
      hasAttachments: message.hasAttachments ?? false,
      internetMessageId: message.internetMessageId ?? null
    }
  });

  await prisma.thread.update({
    where: { id: thread.id },
    data: {
      lastMessageAt:
        receivedAt > thread.lastMessageAt ? receivedAt : thread.lastMessageAt
    }
  });

  await applyThreadIntelligence(thread.id);
}

async function refreshUnreadCounts(mailboxId: string) {
  const threads = await prisma.thread.findMany({
    where: { mailboxId },
    include: {
      messages: {
        select: {
          id: true,
          isRead: true
        }
      }
    }
  });

  await Promise.all(
    threads.map((thread) =>
      prisma.thread.update({
        where: { id: thread.id },
        data: {
          unreadCount: thread.messages.filter((message) => !message.isRead).length
        }
      })
    )
  );
}

export async function ensureArchiveAccount(input: {
  emailAddress: string;
  displayName?: string | null;
}) {
  const normalizedEmail = input.emailAddress.trim().toLowerCase();
  const externalUserId = `archive:${normalizedEmail}`;

  return prisma.account.upsert({
    where: {
      provider_externalUserId: {
        provider: AccountProvider.ARCHIVE,
        externalUserId
      }
    },
    update: {
      email: normalizedEmail,
      displayName: input.displayName ?? normalizedEmail,
      status: AccountStatus.ACTIVE
    },
    create: {
      provider: AccountProvider.ARCHIVE,
      externalUserId,
      email: normalizedEmail,
      displayName: input.displayName ?? normalizedEmail,
      status: AccountStatus.ACTIVE
    }
  });
}

export async function syncMailbox(mailboxId: string) {
  const mailbox = await prisma.mailbox.findUnique({
    where: { id: mailboxId },
    include: {
      account: true
    }
  });

  if (!mailbox) {
    throw new Error(`Mailbox ${mailboxId} was not found.`);
  }

  const accessToken = await ensureFreshAccessToken(mailbox.accountId);
  const env = getEnv();
  const mailboxPath = getMailboxResourcePath(mailbox);

  const params = new URLSearchParams({
    "$top": String(env.MAIL_SYNC_MESSAGE_LIMIT),
    "$select":
      "id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,webLink,isRead,importance,hasAttachments,internetMessageId",
    "$orderby": "receivedDateTime desc"
  });

  const response = await graphFetch<GraphMessagesResponse>(
    `${mailboxPath}/mailFolders/inbox/messages?${params.toString()}`,
    accessToken
  );

  const orderedMessages = [...(response.value ?? [])].sort((left, right) => {
    const leftTime = new Date(left.receivedDateTime ?? 0).getTime();
    const rightTime = new Date(right.receivedDateTime ?? 0).getTime();
    return leftTime - rightTime;
  });

  for (const message of orderedMessages) {
    await ingestNormalizedMessage(mailbox, normalizeGraphMessage(message));
  }

  await refreshUnreadCounts(mailbox.id);

  await prisma.mailbox.update({
    where: { id: mailbox.id },
    data: {
      lastSyncedAt: new Date(),
      lastSyncError: null,
      deltaLink: response["@odata.deltaLink"] ?? mailbox.deltaLink
    }
  });
}

export async function processPendingSyncJobs(limit = 5) {
  const jobs = await prisma.syncJob.findMany({
    where: {
      status: SyncJobStatus.QUEUED
    },
    orderBy: {
      createdAt: "asc"
    },
    take: limit
  });

  for (const job of jobs) {
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: SyncJobStatus.IN_PROGRESS,
        startedAt: new Date(),
        errorText: null
      }
    });

    try {
      await syncMailbox(job.mailboxId);
      await prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: SyncJobStatus.SUCCEEDED,
          finishedAt: new Date()
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error.";

      await prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: SyncJobStatus.FAILED,
          finishedAt: new Date(),
          errorText: message
        }
      });

      await prisma.mailbox.update({
        where: { id: job.mailboxId },
        data: {
          lastSyncError: message
        }
      });
    }
  }
}

export async function scheduleDueSyncs() {
  const env = getEnv();
  const cutoff = new Date(Date.now() - env.MAIL_SYNC_INTERVAL_SECONDS * 1000);

  const mailboxes = await prisma.mailbox.findMany({
    where: {
      account: {
        provider: AccountProvider.MICROSOFT,
        status: AccountStatus.ACTIVE
      },
      OR: [
        {
          lastSyncedAt: null
        },
        {
          lastSyncedAt: {
            lt: cutoff
          }
        }
      ]
    }
  });

  for (const mailbox of mailboxes) {
    await queueMailboxSync(mailbox.id, SyncTrigger.POLL);
  }
}

export async function hydratePrimaryMailbox(accountId: string) {
  const account = await prisma.account.findUnique({
    where: { id: accountId }
  });

  if (!account) {
    throw new Error(`Account ${accountId} was not found.`);
  }

  if (!account.accessToken) {
    throw new Error(`Account ${account.email} does not have a usable Microsoft access token.`);
  }

  const profile = await getMicrosoftProfile(account.accessToken);
  return registerMailbox(accountId, getPrimaryMailboxIdentity(profile));
}
