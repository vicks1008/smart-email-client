import { AccountProvider, AccountStatus, MailboxKind } from "@prisma/client";

import {
  getAppleMailRecentMessagesFromFolder,
  listAppleMailAccounts,
  listAppleMailFolders,
  type AppleMailAccount,
  type AppleMailFolder,
  type AppleMailMessageSummary
} from "./apple-mail";
import { prisma } from "./db";
import { ingestNormalizedMessage, previewFromText, registerMailbox, type NormalizedMessage } from "./mail-sync";

type RecipientSummary = NormalizedMessage["toRecipients"][number];

type AppleMailSyncTarget = {
  mailboxEmail: string;
  mailboxDisplayName: string;
  kind: MailboxKind;
  folders: AppleMailFolder[];
};

type AppleMailIdentity = AppleMailAccount["identities"][number];

export type AppleMailSyncResult = {
  account: {
    id: string;
    email: string;
    displayName: string | null;
  };
  mailbox: {
    id: string;
    emailAddress: string;
    displayName: string;
    kind: "PRIMARY" | "SHARED";
  };
  importedMessages: number;
  folders: Array<{
    path: string;
    name: string;
    type: string;
    availableMessages: number;
    importedMessages: number;
    unreadMessages: number;
  }>;
};

export type AppleMailSummaryIngestPayload = {
  account: AppleMailAccount;
  folders: AppleMailFolder[];
  messagesByFolder: Array<{
    folderPath: string;
    messages: AppleMailMessageSummary[];
  }>;
};

function parseAppleMailSummaryDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/\u202f|\u00a0/g, " ")
    .replace(/\s+at\s+/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  const candidates = [normalized, normalized.replace(/^[A-Za-z]+,\s*/, "")];

  for (const candidate of candidates) {
    const parsed = new Date(candidate);
    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function appleMailSummaryTime(value?: string | null) {
  return parseAppleMailSummaryDate(value)?.getTime() ?? Number.NEGATIVE_INFINITY;
}

function sortAppleMailSummariesNewestFirst<T extends { date?: string | null }>(summaries: T[]) {
  return [...summaries].sort((left, right) => appleMailSummaryTime(right.date) - appleMailSummaryTime(left.date));
}

function normalizeAddress(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizedSubject(subject?: string | null) {
  return (subject ?? "(no subject)")
    .trim()
    .replace(/^(re|fw|fwd):\s*/gi, "")
    .toLowerCase();
}

function splitAddressHeader(value?: string | null) {
  return (value ?? "")
    .split(/[;,](?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseAddressToken(token: string): RecipientSummary | null {
  const angleMatch = token.match(/^(.*)<([^>]+)>$/);
  if (angleMatch) {
    const name = angleMatch[1]?.replace(/^"|"$/g, "").trim() || angleMatch[2].trim();
    const address = normalizeAddress(angleMatch[2]);
    return address ? { address, name } : null;
  }

  const emailMatch = token.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!emailMatch) {
    return null;
  }

  const address = normalizeAddress(emailMatch[0]);
  const name = token.replace(emailMatch[0], "").replace(/[<>"]/g, "").trim() || address;
  return { address, name };
}

function parseAddressHeader(value?: string | null) {
  return splitAddressHeader(value)
    .map((token) => parseAddressToken(token))
    .filter((entry): entry is RecipientSummary => Boolean(entry?.address));
}

function firstAddress(value?: string | null, fallbackAddress?: string | null, fallbackName?: string | null) {
  const first = parseAddressHeader(value)[0];
  if (first) {
    return first;
  }

  const normalizedFallback = normalizeAddress(fallbackAddress);
  return normalizedFallback
    ? {
        address: normalizedFallback,
        name: fallbackName?.trim() || normalizedFallback
      }
    : null;
}

function uniqueRecipients(recipients: RecipientSummary[]) {
  return Array.from(new Map(recipients.map((recipient) => [`${recipient.name}|${recipient.address}`, recipient])).values());
}

function normalizedPseudoAddress(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const fullEmailMatch = trimmed.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  if (fullEmailMatch) {
    return fullEmailMatch.toLowerCase();
  }

  if (!trimmed.includes("@")) {
    return null;
  }

  const [rawLocal = "", rawDomain = "apple-mail"] = trimmed.split("@", 2);
  const local = rawLocal.replace(/[^a-z0-9._%+-]+/g, "-").replace(/^-+|-+$/g, "") || "mailbox";
  let domain = rawDomain.replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "apple-mail";
  if (!domain.includes(".")) {
    domain = `${domain}.local`;
  }

  return `${local}@${domain}`;
}

function defaultIdentity(account: AppleMailAccount) {
  return (
    account.identities.find((identity) => identity.isDefault && normalizeAddress(identity.email)) ??
    account.identities.find((identity) => normalizeAddress(identity.email)) ??
    null
  );
}

function primaryMailboxAddress(account: AppleMailAccount, identity: AppleMailIdentity | null) {
  return (
    normalizeAddress(identity?.email) ||
    normalizedPseudoAddress(account.name) ||
    `${account.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@apple-mail.local`
  );
}

function sharedMailboxTargets(folders: AppleMailFolder[], primaryEmail: string) {
  const grouped = new Map<string, AppleMailSyncTarget>();

  for (const folder of folders) {
    if (folder.type !== "custom" || !folder.name.includes("@")) {
      continue;
    }

    const mailboxEmail = normalizedPseudoAddress(folder.name);
    if (!mailboxEmail || mailboxEmail === primaryEmail) {
      continue;
    }

    const existing = grouped.get(mailboxEmail);
    if (existing) {
      existing.folders.push(folder);
      continue;
    }

    grouped.set(mailboxEmail, {
      mailboxEmail,
      mailboxDisplayName: folder.name,
      kind: MailboxKind.SHARED,
      folders: [folder]
    });
  }

  return Array.from(grouped.values());
}

function selectSyncTargets(account: AppleMailAccount, folders: AppleMailFolder[]) {
  const identity = defaultIdentity(account);
  const primaryEmail = primaryMailboxAddress(account, identity);
  const primaryFolders = folders.filter((folder) => folder.type === "inbox" || folder.type === "sent");
  const targets: AppleMailSyncTarget[] = [];

  if (primaryFolders.length > 0) {
    targets.push({
      mailboxEmail: primaryEmail,
      mailboxDisplayName: identity?.name?.trim() || account.name || primaryEmail,
      kind: MailboxKind.PRIMARY,
      folders: primaryFolders
    });
  }

  targets.push(...sharedMailboxTargets(folders, primaryEmail));
  return targets;
}

function conversationKeyFromAppleMail(input: {
  subject: string;
  mailboxEmail: string;
  fromAddress?: string | null;
  toRecipients: RecipientSummary[];
  ccRecipients: RecipientSummary[];
  threadId?: string | null;
  references?: string[];
  inReplyTo?: string | null;
}) {
  if (input.threadId?.trim()) {
    return `apple:thread:${input.mailboxEmail}:${input.threadId.trim()}`;
  }

  const referenceRoot = input.references?.[0] ?? input.inReplyTo ?? null;
  if (referenceRoot) {
    return `apple:ref:${referenceRoot.toLowerCase()}`;
  }

  const counterparty = uniqueRecipients(
    [
      ...(input.fromAddress
        ? [
            {
              address: normalizeAddress(input.fromAddress),
              name: normalizeAddress(input.fromAddress)
            }
          ]
        : []),
      ...input.toRecipients,
      ...input.ccRecipients
    ].filter((recipient) => recipient.address && recipient.address !== input.mailboxEmail)
  )
    .map((recipient) => recipient.address)
    .sort()
    .slice(0, 3)
    .join(",");

  return `apple:subject:${normalizedSubject(input.subject)}:${counterparty || input.mailboxEmail}`;
}

function normalizedMessageFromAppleMail(input: {
  summary: AppleMailMessageSummary;
  folderType: string;
  mailboxEmail: string;
  mailboxName: string;
}) {
  const toRecipients = parseAddressHeader(input.summary.recipients);
  const ccRecipients = parseAddressHeader(input.summary.ccList);
  const fallbackSender =
    input.folderType === "sent"
      ? {
          address: normalizeAddress(input.mailboxEmail),
          name: input.mailboxName || input.mailboxEmail
        }
      : null;
  const from = firstAddress(input.summary.author, fallbackSender?.address, fallbackSender?.name);
  const subject = input.summary.subject?.trim() || "(no subject)";
  const receivedAt = parseAppleMailSummaryDate(input.summary.date) ?? new Date();
  const bodyText = "Imported summary from Apple Mail. Open the Apple Mail live view for full message content.";

  return {
    externalMessageId: `${input.summary.folderPath}:${input.summary.id}`,
    externalConversationId: conversationKeyFromAppleMail({
      subject,
      mailboxEmail: input.mailboxEmail,
      fromAddress: from?.address,
      toRecipients,
      ccRecipients,
      threadId: null,
      references: [],
      inReplyTo: null
    }),
    internetMessageId: input.summary.id || null,
    subject,
    fromName: from?.name ?? null,
    fromAddress: from?.address ?? null,
    toRecipients,
    ccRecipients,
    receivedAt,
    sentAt: receivedAt,
    bodyPreview: `Apple Mail summary from ${from?.name ?? from?.address ?? "the sender"}`,
    bodyText,
    bodyHtml: null,
    webLink: null,
    importance: null,
    isRead: input.summary.read,
    hasAttachments: false
  } satisfies NormalizedMessage;
}

async function ensureAppleMailAccountRecord(account: AppleMailAccount) {
  const identity = defaultIdentity(account);
  const email = primaryMailboxAddress(account, identity);
  const displayName = identity?.name?.trim() || account.name || email;

  return prisma.account.upsert({
    where: {
      provider_externalUserId: {
        provider: AccountProvider.APPLE_MAIL,
        externalUserId: account.id
      }
    },
    update: {
      email,
      displayName,
      status: AccountStatus.ACTIVE
    },
    create: {
      provider: AccountProvider.APPLE_MAIL,
      externalUserId: account.id,
      email,
      displayName,
      status: AccountStatus.ACTIVE
    }
  });
}

async function refreshUnreadCounts(mailboxId: string) {
  const threads = await prisma.thread.findMany({
    where: {
      mailboxId
    },
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
        where: {
          id: thread.id
        },
        data: {
          unreadCount: thread.messages.filter((message) => !message.isRead).length
        }
      })
    )
  );
}

async function syncAppleMailTargetMailbox(input: {
  account: AppleMailAccount;
  accountRecord: Awaited<ReturnType<typeof ensureAppleMailAccountRecord>>;
  target: AppleMailSyncTarget;
  maxMessagesPerFolder: number;
  recentDays?: number;
}) {
  const mailbox = await registerMailbox(input.accountRecord.id, {
    emailAddress: input.target.mailboxEmail,
    displayName: input.target.mailboxDisplayName,
    kind: input.target.kind
  });

  const mailboxRecord = await prisma.mailbox.findUniqueOrThrow({
    where: {
      id: mailbox.id
    }
  });

  let importedMessages = 0;
  const syncedFolders: AppleMailSyncResult["folders"] = [];

  try {
    for (const folder of input.target.folders) {
      const summaries = sortAppleMailSummariesNewestFirst(
        await getAppleMailRecentMessagesFromFolder(folder.path, input.maxMessagesPerFolder, input.recentDays)
      );

      let importedForFolder = 0;
      for (const summary of summaries) {
        await ingestNormalizedMessage(
          mailboxRecord,
          normalizedMessageFromAppleMail({
            summary,
            folderType: folder.type,
            mailboxEmail: input.target.mailboxEmail,
            mailboxName: input.target.mailboxDisplayName
          })
        );
        importedMessages += 1;
        importedForFolder += 1;
      }

      syncedFolders.push({
        path: folder.path,
        name: folder.name,
        type: folder.type,
        availableMessages: summaries.length,
        importedMessages: importedForFolder,
        unreadMessages: folder.unreadMessages
      });
    }

    await refreshUnreadCounts(mailbox.id);
    await prisma.thread.deleteMany({
      where: {
        mailboxId: mailbox.id,
        messages: {
          none: {}
        }
      }
    });
    await prisma.mailbox.update({
      where: {
        id: mailbox.id
      },
      data: {
        lastSyncedAt: new Date(),
        lastSyncError: null
      }
    });

    return {
      account: {
        id: input.accountRecord.id,
        email: input.accountRecord.email,
        displayName: input.accountRecord.displayName
      },
      mailbox: {
        id: mailbox.id,
        emailAddress: mailbox.emailAddress,
        displayName: mailbox.displayName,
        kind: mailbox.kind
      },
      importedMessages,
      folders: syncedFolders
    } satisfies AppleMailSyncResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Apple Mail sync failed.";
    await prisma.mailbox.update({
      where: {
        id: mailbox.id
      },
      data: {
        lastSyncError: message
      }
    });
    throw error;
  }
}

async function syncAppleMailTargetMailboxFromSummaries(input: {
  accountRecord: Awaited<ReturnType<typeof ensureAppleMailAccountRecord>>;
  target: AppleMailSyncTarget;
  messagesByFolder: Map<string, AppleMailMessageSummary[]>;
}) {
  const mailbox = await registerMailbox(input.accountRecord.id, {
    emailAddress: input.target.mailboxEmail,
    displayName: input.target.mailboxDisplayName,
    kind: input.target.kind
  });

  const mailboxRecord = await prisma.mailbox.findUniqueOrThrow({
    where: {
      id: mailbox.id
    }
  });

  let importedMessages = 0;
  const syncedFolders: AppleMailSyncResult["folders"] = [];

  try {
    for (const folder of input.target.folders) {
      const summaries = sortAppleMailSummariesNewestFirst(input.messagesByFolder.get(folder.path) ?? []);

      let importedForFolder = 0;
      for (const summary of summaries) {
        await ingestNormalizedMessage(
          mailboxRecord,
          normalizedMessageFromAppleMail({
            summary,
            folderType: folder.type,
            mailboxEmail: input.target.mailboxEmail,
            mailboxName: input.target.mailboxDisplayName
          })
        );
        importedMessages += 1;
        importedForFolder += 1;
      }

      syncedFolders.push({
        path: folder.path,
        name: folder.name,
        type: folder.type,
        availableMessages: summaries.length,
        importedMessages: importedForFolder,
        unreadMessages: folder.unreadMessages
      });
    }

    await refreshUnreadCounts(mailbox.id);
    await prisma.thread.deleteMany({
      where: {
        mailboxId: mailbox.id,
        messages: {
          none: {}
        }
      }
    });
    await prisma.mailbox.update({
      where: {
        id: mailbox.id
      },
      data: {
        lastSyncedAt: new Date(),
        lastSyncError: null
      }
    });

    return {
      account: {
        id: input.accountRecord.id,
        email: input.accountRecord.email,
        displayName: input.accountRecord.displayName
      },
      mailbox: {
        id: mailbox.id,
        emailAddress: mailbox.emailAddress,
        displayName: mailbox.displayName,
        kind: mailbox.kind
      },
      importedMessages,
      folders: syncedFolders
    } satisfies AppleMailSyncResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Apple Mail ingest failed.";
    await prisma.mailbox.update({
      where: {
        id: mailbox.id
      },
      data: {
        lastSyncError: message
      }
    });
    throw error;
  }
}

export async function syncAppleMailAccountIntoWorkbench(input: {
  appleMailAccountId: string;
  maxMessagesPerFolder?: number;
  recentDays?: number;
}) {
  const accounts = await listAppleMailAccounts();
  const appleMailAccount = accounts.find((account) => account.id === input.appleMailAccountId);

  if (!appleMailAccount) {
    throw new Error("Apple Mail account was not found.");
  }

  const folders = await listAppleMailFolders(appleMailAccount.id);
  const targets = selectSyncTargets(appleMailAccount, folders);

  if (targets.length === 0) {
    throw new Error("No Apple Mail inboxes or shared mailbox folders were found to sync.");
  }

  const accountRecord = await ensureAppleMailAccountRecord(appleMailAccount);
  const results: AppleMailSyncResult[] = [];

  for (const target of targets) {
    results.push(
      await syncAppleMailTargetMailbox({
        account: appleMailAccount,
        accountRecord,
        target,
        maxMessagesPerFolder: input.maxMessagesPerFolder ?? 25,
        recentDays: input.recentDays ?? 365
      })
    );
  }

  return results;
}

export async function syncAllAppleMailAccountsIntoWorkbench(input?: {
  maxMessagesPerFolder?: number;
  recentDays?: number;
}) {
  const accounts = await listAppleMailAccounts();
  const results: AppleMailSyncResult[] = [];

  for (const account of accounts) {
    results.push(
      ...(await syncAppleMailAccountIntoWorkbench({
        appleMailAccountId: account.id,
        maxMessagesPerFolder: input?.maxMessagesPerFolder ?? 25,
        recentDays: input?.recentDays ?? 365
      }))
    );
  }

  return results;
}

export async function syncPersistedAppleMailAccountIntoWorkbench(input: {
  accountId: string;
  maxMessagesPerFolder?: number;
  recentDays?: number;
}) {
  const account = await prisma.account.findUnique({
    where: {
      id: input.accountId
    }
  });

  if (!account || account.provider !== AccountProvider.APPLE_MAIL) {
    throw new Error("Apple Mail account was not found.");
  }

  return syncAppleMailAccountIntoWorkbench({
    appleMailAccountId: account.externalUserId,
    maxMessagesPerFolder: input.maxMessagesPerFolder ?? 25,
    recentDays: input.recentDays ?? 365
  });
}

export async function ingestAppleMailAccountSummariesIntoWorkbench(input: AppleMailSummaryIngestPayload) {
  const targets = selectSyncTargets(input.account, input.folders);

  if (targets.length === 0) {
    throw new Error("No Apple Mail inboxes or shared mailbox folders were found to ingest.");
  }

  const accountRecord = await ensureAppleMailAccountRecord(input.account);
  const messagesByFolder = new Map(input.messagesByFolder.map((entry) => [entry.folderPath, entry.messages]));
  const results: AppleMailSyncResult[] = [];

  for (const target of targets) {
    results.push(
      await syncAppleMailTargetMailboxFromSummaries({
        accountRecord,
        target,
        messagesByFolder
      })
    );
  }

  return results;
}
