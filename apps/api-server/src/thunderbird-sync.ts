import { createHash } from "node:crypto";

import {
  MailboxKind,
  ensureArchiveAccount,
  ingestNormalizedMessage,
  previewFromText,
  prisma,
  registerMailbox,
  type NormalizedMessage
} from "@smart-email/core";

import {
  getThunderbirdMessageDetail,
  getThunderbirdRecentMessages,
  listThunderbirdAccounts,
  listThunderbirdFolders,
  type ThunderbirdFolder
} from "./thunderbird";

const TEAM_SHARED_MAILBOX = "hey@razzinteractive.com";

type RecipientSummary = {
  address: string;
  name: string;
};

function normalizeAddress(address?: string | null) {
  return address?.trim().toLowerCase() ?? "";
}

function sha1(value: string) {
  return createHash("sha1").update(value).digest("hex");
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
    return address
      ? {
          address,
          name
        }
      : null;
  }

  const emailMatch = token.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!emailMatch) {
    return null;
  }

  const address = normalizeAddress(emailMatch[0]);
  const name = token.replace(emailMatch[0], "").replace(/[<>"]/g, "").trim() || address;
  return {
    address,
    name
  };
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

function conversationKey(input: {
  subject: string;
  folderType: string;
  fromAddress?: string | null;
  recipients: RecipientSummary[];
  mailboxEmail: string;
}) {
  const counterparty =
    input.folderType === "sent"
      ? input.recipients[0]?.address ?? input.mailboxEmail
      : normalizeAddress(input.fromAddress) || input.mailboxEmail;

  return `tb:subject:${normalizedSubject(input.subject)}:${counterparty}`;
}

function mailboxKindForTarget(mailboxEmail: string, identityEmail?: string | null) {
  const normalizedMailbox = normalizeAddress(mailboxEmail);
  const normalizedIdentity = normalizeAddress(identityEmail);

  if (normalizedMailbox === TEAM_SHARED_MAILBOX) {
    return MailboxKind.SHARED;
  }

  return normalizedIdentity && normalizedMailbox !== normalizedIdentity ? MailboxKind.SHARED : MailboxKind.PRIMARY;
}

function selectFoldersForSync(folders: ThunderbirdFolder[]) {
  const inboxFolders = folders.filter((folder) => folder.type === "inbox");
  const sentFolders = folders.filter((folder) => folder.type === "sent");

  return [...inboxFolders, ...sentFolders].sort((left, right) => left.depth - right.depth);
}

function normalizedMessageFromThunderbird(params: {
  messageId: string;
  folderPath: string;
  folderType: string;
  mailboxEmail: string;
  mailboxName: string;
  author?: string | null;
  recipients?: string | null;
  ccList?: string | null;
  subject?: string | null;
  date?: string | null;
  body?: string | null;
  read?: boolean;
  attachments?: Array<unknown>;
}) {
  const toRecipients = parseAddressHeader(params.recipients);
  const ccRecipients = parseAddressHeader(params.ccList);
  const fallbackSender =
    params.folderType === "sent"
      ? {
          address: normalizeAddress(params.mailboxEmail),
          name: params.mailboxName || params.mailboxEmail
        }
      : null;
  const from = firstAddress(params.author, fallbackSender?.address, fallbackSender?.name);
  const receivedAt = params.date ? new Date(params.date) : new Date();
  const subject = params.subject?.trim() || "(no subject)";
  const externalMessageId = `${params.folderPath}:${params.messageId || sha1(`${subject}:${receivedAt.toISOString()}`)}`;
  const bodyText = (params.body ?? "").trim();

  return {
    externalMessageId,
    externalConversationId: conversationKey({
      subject,
      folderType: params.folderType,
      fromAddress: from?.address,
      recipients: toRecipients,
      mailboxEmail: params.mailboxEmail
    }),
    internetMessageId: params.messageId || null,
    subject,
    fromName: from?.name ?? null,
    fromAddress: from?.address ?? null,
    toRecipients,
    ccRecipients,
    receivedAt,
    sentAt: receivedAt,
    bodyPreview: previewFromText(bodyText),
    bodyText,
    bodyHtml: null,
    webLink: null,
    importance: null,
    isRead: params.read ?? true,
    hasAttachments: (params.attachments?.length ?? 0) > 0
  } satisfies NormalizedMessage;
}

export async function syncThunderbirdAccountIntoWorkbench(input: {
  thunderbirdAccountId: string;
  mailboxEmail?: string;
  mailboxDisplayName?: string;
  daysBack?: number;
  maxMessagesPerFolder?: number;
}) {
  const accounts = await listThunderbirdAccounts();
  const thunderbirdAccount = accounts.find((account) => account.id === input.thunderbirdAccountId);

  if (!thunderbirdAccount) {
    throw new Error("Thunderbird account was not found.");
  }

  const defaultIdentity =
    thunderbirdAccount.identities.find((identity) => identity.isDefault) ?? thunderbirdAccount.identities[0] ?? null;

  const mailboxEmail = normalizeAddress(input.mailboxEmail) || normalizeAddress(defaultIdentity?.email);
  if (!mailboxEmail) {
    throw new Error("This Thunderbird account does not expose an email address. Provide one manually.");
  }

  const mailboxDisplayName =
    input.mailboxDisplayName?.trim() || defaultIdentity?.name?.trim() || thunderbirdAccount.name || mailboxEmail;

  const archiveAccount = await ensureArchiveAccount({
    emailAddress: mailboxEmail,
    displayName: mailboxDisplayName
  });

  const mailbox = await registerMailbox(archiveAccount.id, {
    emailAddress: mailboxEmail,
    displayName: mailboxDisplayName,
    kind: mailboxKindForTarget(mailboxEmail, defaultIdentity?.email)
  });

  const mailboxRecord = await prisma.mailbox.findUniqueOrThrow({
    where: {
      id: mailbox.id
    }
  });

  const folders = await listThunderbirdFolders(input.thunderbirdAccountId);
  const targetFolders = selectFoldersForSync(folders);

  if (targetFolders.length === 0) {
    throw new Error("No Inbox or Sent folders were found for that Thunderbird account.");
  }

  let importedMessages = 0;

  for (const folder of targetFolders) {
    const summaries = await getThunderbirdRecentMessages({
      folderPath: folder.path,
      daysBack: input.daysBack ?? 30,
      maxResults: input.maxMessagesPerFolder ?? 200
    });

    for (const summary of summaries) {
      const detail = await getThunderbirdMessageDetail(summary.id, summary.folderPath);
      const normalized = normalizedMessageFromThunderbird({
        messageId: summary.id,
        folderPath: summary.folderPath,
        folderType: folder.type,
        mailboxEmail,
        mailboxName: mailboxDisplayName,
        author: detail.author ?? summary.author,
        recipients: detail.recipients ?? summary.recipients,
        ccList: detail.ccList ?? summary.ccList,
        subject: detail.subject ?? summary.subject,
        date: detail.date ?? summary.date,
        body: detail.body,
        read: summary.read,
        attachments: detail.attachments
      });

      await ingestNormalizedMessage(mailboxRecord, normalized);
      importedMessages += 1;
    }
  }

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
    account: archiveAccount,
    mailbox: mailboxRecord,
    importedMessages,
    folders: targetFolders.map((folder) => ({
      path: folder.path,
      name: folder.name,
      type: folder.type
    }))
  };
}
