import { createHash } from "node:crypto";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MailboxKind } from "@prisma/client";

import { prisma } from "./db";
import { getEnv } from "./env";
import {
  ensureArchiveAccount,
  ingestNormalizedMessage,
  previewFromText,
  registerMailbox,
  type NormalizedMessage
} from "./mail-sync";

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

type ThunderbirdToolResult = {
  content: Array<{
    type: string;
    text: string;
  }>;
};

export type ThunderbirdStatus = {
  available: boolean;
  profilePaths: string[];
  bridgeUrl: string;
  serverInfo?: {
    name: string;
    version: string;
  };
  error?: string;
};

export type ThunderbirdAccount = {
  id: string;
  name: string;
  type: string;
  identities: Array<{
    id: string;
    email: string;
    name: string;
    isDefault: boolean;
  }>;
};

export type ThunderbirdFolder = {
  name: string;
  path: string;
  type: string;
  accountId: string;
  totalMessages: number;
  unreadMessages: number;
  depth: number;
};

export type ThunderbirdMessageSummary = {
  id: string;
  subject: string;
  author: string;
  recipients: string;
  ccList?: string;
  date: string | null;
  folder: string;
  folderPath: string;
  read: boolean;
  flagged: boolean;
};

export type ThunderbirdMessageMetadata = ThunderbirdMessageSummary & {
  accountId: string | null;
  accountName: string | null;
  serverType: string | null;
  folderType: string | null;
  messageKey: number | null;
  threadId: number | null;
  threadParent: number | null;
  references: string[];
  inReplyTo: string | null;
  size: number | null;
  lineCount: number | null;
  priority: string | null;
  keywords: string;
  charset: string | null;
};

export type ThunderbirdMessageDetail = ThunderbirdMessageMetadata & {
  body: string;
  bodyIsHtml: boolean;
  attachments: Array<{
    name: string;
    contentType: string;
    size: number | null;
  }>;
};

export type ThunderbirdFolderMessagesPage = {
  folder: {
    name: string;
    path: string;
    type: string;
  };
  totalMessages: number;
  offset: number;
  returned: number;
  messages: ThunderbirdMessageSummary[];
};

export type ThunderbirdFolderStatistics = {
  folder: {
    name: string;
    path: string;
    type: string;
    accountId: string | null;
    accountName: string | null;
  };
  includeSubfolders: boolean;
  foldersScanned: Array<{
    name: string;
    path: string;
    type: string;
    totalMessages: number;
    unreadMessages: number;
  }>;
  totalMessages: number;
  unreadMessages: number;
  readMessages: number;
  flaggedMessages: number;
  oldestMessageDate: string | null;
  newestMessageDate: string | null;
};

export type ThunderbirdRawMessage = ThunderbirdMessageMetadata & {
  source: string;
  sourceBytes: number;
  returnedBytes: number;
  truncated: boolean;
};

type ToolsListResult = {
  tools: Array<{
    name: string;
    title?: string;
    description?: string;
  }>;
};

type RecipientSummary = {
  address: string;
  name: string;
};

type ThunderbirdMailboxCandidate = {
  thunderbirdAccountId: string;
  thunderbirdAccountName: string;
  thunderbirdIdentityId: string | null;
  thunderbirdIdentityEmail: string | null;
  thunderbirdIdentityName: string | null;
  mailboxEmail: string;
  mailboxDisplayName: string;
};

const DEFAULT_PROFILE_ROOT = join(homedir(), "Library", "Thunderbird", "Profiles");
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TEAM_SHARED_MAILBOX = "hey@razzinteractive.com";

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

function conversationKeyFromThunderbird(input: {
  subject: string;
  folderType: string;
  fromAddress?: string | null;
  recipients: RecipientSummary[];
  mailboxEmail: string;
  accountId?: string | null;
  threadId?: number | null;
  references?: string[];
  inReplyTo?: string | null;
}) {
  if (typeof input.threadId === "number") {
    return `tb:thread:${input.accountId ?? input.mailboxEmail}:${input.threadId}`;
  }

  const referenceRoot = input.references?.[0] ?? input.inReplyTo ?? null;
  if (referenceRoot) {
    return `tb:ref:${referenceRoot.toLowerCase()}`;
  }

  return conversationKey(input);
}

function parseRawHeaders(source: string) {
  const [headerBlock = ""] = source.split(/\r?\n\r?\n/, 1);
  const headers = new Map<string, string>();
  let currentName = "";

  for (const line of headerBlock.split(/\r?\n/)) {
    if (!line) {
      break;
    }

    if (/^[ \t]/.test(line) && currentName) {
      headers.set(currentName, `${headers.get(currentName) ?? ""} ${line.trim()}`.trim());
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }

    currentName = line.slice(0, separatorIndex).trim().toLowerCase();
    headers.set(currentName, line.slice(separatorIndex + 1).trim());
  }

  return headers;
}

function rawHeaderValue(headers: Map<string, string>, ...names: string[]) {
  for (const name of names) {
    const value = headers.get(name.toLowerCase());
    if (value) {
      return value;
    }
  }

  return null;
}

function needsRawHeaderFallback(message: ThunderbirdMessageDetail) {
  return (
    !message.subject?.trim() ||
    !message.author?.trim() ||
    (!message.recipients?.trim() && !message.ccList?.trim()) ||
    (!message.references?.length && !message.inReplyTo && message.threadId == null)
  );
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

function inferMailboxCandidates(accounts: ThunderbirdAccount[]): ThunderbirdMailboxCandidate[] {
  return accounts.flatMap((account) => {
    const identities = account.identities.filter((identity) => Boolean(normalizeAddress(identity.email)));

    if (identities.length > 0) {
      return identities.map((identity): ThunderbirdMailboxCandidate => ({
        thunderbirdAccountId: account.id,
        thunderbirdAccountName: account.name,
        thunderbirdIdentityId: identity.id,
        thunderbirdIdentityEmail: normalizeAddress(identity.email),
        thunderbirdIdentityName: identity.name?.trim() || identity.email,
        mailboxEmail: normalizeAddress(identity.email),
        mailboxDisplayName: identity.name?.trim() || account.name || identity.email
      }));
    }

    const accountNameEmail = account.name.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
    if (!accountNameEmail) {
      return [];
    }

    return [
      {
        thunderbirdAccountId: account.id,
        thunderbirdAccountName: account.name,
        thunderbirdIdentityId: null,
        thunderbirdIdentityEmail: normalizeAddress(accountNameEmail),
        thunderbirdIdentityName: account.name,
        mailboxEmail: normalizeAddress(accountNameEmail),
        mailboxDisplayName: account.name || accountNameEmail
      }
    ];
  });
}

function normalizedMessageFromThunderbird(params: {
  messageId: string;
  folderPath: string;
  folderType: string;
  mailboxEmail: string;
  mailboxName: string;
  accountId?: string | null;
  threadId?: number | null;
  references?: string[];
  inReplyTo?: string | null;
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
    externalConversationId: conversationKeyFromThunderbird({
      subject,
      folderType: params.folderType,
      fromAddress: from?.address,
      recipients: toRecipients,
      mailboxEmail: params.mailboxEmail,
      accountId: params.accountId,
      threadId: params.threadId,
      references: params.references,
      inReplyTo: params.inReplyTo
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

async function findThunderbirdProfiles() {
  try {
    const entries = await readdir(DEFAULT_PROFILE_ROOT, {
      withFileTypes: true
    });

    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(DEFAULT_PROFILE_ROOT, entry.name));
  } catch {
    return [];
  }
}

async function thunderbirdJsonRpc<T>(payload: Record<string, unknown>) {
  const env = getEnv();
  const response = await fetch(env.THUNDERBIRD_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Thunderbird bridge returned ${response.status}.`);
  }

  const body = (await response.json()) as JsonRpcResponse<T>;

  if (body.error) {
    throw new Error(body.error.message);
  }

  if (!body.result) {
    throw new Error("Thunderbird bridge returned an empty result.");
  }

  return body.result;
}

async function callTool<T>(name: string, args: Record<string, unknown> = {}) {
  const result = await thunderbirdJsonRpc<ThunderbirdToolResult>({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: args
    }
  });

  const text = result.content.find((entry) => entry.type === "text")?.text ?? "null";
  return JSON.parse(text) as T;
}

export async function getThunderbirdStatus(): Promise<ThunderbirdStatus> {
  const env = getEnv();
  const profilePaths = await findThunderbirdProfiles();

  try {
    const tools = await thunderbirdJsonRpc<ToolsListResult>({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    });

    return {
      available: true,
      profilePaths,
      bridgeUrl: env.THUNDERBIRD_MCP_URL,
      serverInfo: {
        name: "Thunderbird MCP",
        version: `${tools.tools.length} tools`
      }
    };
  } catch (error) {
    return {
      available: false,
      profilePaths,
      bridgeUrl: env.THUNDERBIRD_MCP_URL,
      error: error instanceof Error ? error.message : "Thunderbird MCP bridge is not available."
    };
  }
}

export async function listThunderbirdAccounts() {
  return callTool<ThunderbirdAccount[]>("listAccounts");
}

export async function listThunderbirdFolders(accountId?: string) {
  return callTool<ThunderbirdFolder[]>("listFolders", accountId ? { accountId } : {});
}

export async function getThunderbirdRecentMessages(input: {
  folderPath?: string;
  daysBack?: number;
  maxResults?: number;
  unreadOnly?: boolean;
  flaggedOnly?: boolean;
}) {
  return callTool<ThunderbirdMessageSummary[]>("getRecentMessages", input);
}

export async function searchThunderbirdMessages(input: {
  query: string;
  folderPath?: string;
  startDate?: string;
  endDate?: string;
  maxResults?: number;
  unreadOnly?: boolean;
  flaggedOnly?: boolean;
  sortOrder?: "asc" | "desc";
}) {
  return callTool<ThunderbirdMessageSummary[]>("searchMessages", input);
}

export async function listThunderbirdMessagesInFolder(input: {
  folderPath: string;
  maxResults?: number;
  offset?: number;
  sortOrder?: "asc" | "desc";
  unreadOnly?: boolean;
  flaggedOnly?: boolean;
  includeSubfolders?: boolean;
}) {
  return callTool<ThunderbirdFolderMessagesPage>("listMessagesInFolder", input);
}

export async function getThunderbirdFolderStatistics(folderPath: string, includeSubfolders = false) {
  return callTool<ThunderbirdFolderStatistics>("getFolderStatistics", {
    folderPath,
    includeSubfolders
  });
}

export async function getThunderbirdMessageMetadata(messageId: string, folderPath: string) {
  return callTool<ThunderbirdMessageMetadata>("getMessageMetadata", {
    messageId,
    folderPath
  });
}

export async function getThunderbirdMessageDetail(messageId: string, folderPath: string) {
  return callTool<ThunderbirdMessageDetail>("getMessage", {
    messageId,
    folderPath
  });
}

export async function getThunderbirdRawMessage(messageId: string, folderPath: string, maxBytes?: number) {
  return callTool<ThunderbirdRawMessage>("getRawMessage", {
    messageId,
    folderPath,
    ...(typeof maxBytes === "number" ? { maxBytes } : {})
  });
}

export async function getThunderbirdThreadMessages(input: {
  messageId: string;
  folderPath: string;
  includeBodies?: boolean;
  maxResults?: number;
}) {
  return callTool<{
    threadAnchor: {
      messageId: string;
      folderPath: string;
      subject: string;
      threadId: number | null;
    };
    returned: number;
    messages: Array<ThunderbirdMessageMetadata | ThunderbirdMessageDetail>;
  }>("getThreadMessages", input);
}

export async function thunderbirdSetupProbe() {
  const status = await getThunderbirdStatus();
  const extensionXpiPath = join(REPO_ROOT, "tools", "thunderbird-mcp", "dist", "thunderbird-mcp.xpi");
  let bundledXpiDetected = false;

  try {
    await access(extensionXpiPath);
    bundledXpiDetected = true;
  } catch {
    bundledXpiDetected = false;
  }

  return {
    ...status,
    bundledXpiDetected,
    extensionXpiPath: bundledXpiDetected ? extensionXpiPath : null,
    setupSteps: [
      "Install the Thunderbird MCP extension XPI in Thunderbird.",
      "Restart Thunderbird so the localhost bridge starts on port 8765.",
      "Reopen /mail and choose the Thunderbird live source."
    ]
  };
}

export async function listThunderbirdSyncSources() {
  return prisma.thunderbirdSyncSource.findMany({
    include: {
      mailbox: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

export async function listThunderbirdDiscoveredMailboxes() {
  const accounts = await listThunderbirdAccounts();
  const discovered = inferMailboxCandidates(accounts);

  return discovered.map((candidate) => ({
    ...candidate,
    kind: mailboxKindForTarget(candidate.mailboxEmail, candidate.thunderbirdIdentityEmail),
    isTeamMailbox: candidate.mailboxEmail === TEAM_SHARED_MAILBOX
  }));
}

async function loadThunderbirdFolderMessagesForSync(
  folder: ThunderbirdFolder,
  daysBack: number,
  maxMessages: number
) {
  const stats = await getThunderbirdFolderStatistics(folder.path);
  const cutoffTime = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const collected: ThunderbirdMessageSummary[] = [];
  let offset = 0;
  let hitCutoff = false;

  while (collected.length < maxMessages && offset < stats.totalMessages) {
    const remaining = maxMessages - collected.length;
    const page = await listThunderbirdMessagesInFolder({
      folderPath: folder.path,
      maxResults: Math.min(remaining, 100),
      offset,
      sortOrder: "desc"
    });

    if (page.messages.length === 0) {
      break;
    }

    for (const summary of page.messages) {
      const messageTime = summary.date ? new Date(summary.date).getTime() : Number.NaN;
      if (Number.isFinite(messageTime) && messageTime < cutoffTime) {
        hitCutoff = true;
        break;
      }

      collected.push(summary);
      if (collected.length >= maxMessages) {
        break;
      }
    }

    if (hitCutoff || page.returned < Math.min(remaining, 100)) {
      break;
    }

    offset += page.returned;
  }

  return {
    stats,
    messages: collected.sort((left, right) => {
      const leftTime = new Date(left.date ?? 0).getTime();
      const rightTime = new Date(right.date ?? 0).getTime();
      return leftTime - rightTime;
    })
  };
}

export async function syncThunderbirdAccountIntoWorkbench(input: {
  thunderbirdAccountId: string;
  mailboxEmail?: string;
  mailboxDisplayName?: string;
  daysBack?: number;
  maxMessagesPerFolder?: number;
  enabled?: boolean;
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
  const syncedFolders: Array<{
    path: string;
    name: string;
    type: string;
    availableMessages: number;
    importedMessages: number;
    unreadMessages: number;
  }> = [];

  try {
    for (const folder of targetFolders) {
      const folderSync = await loadThunderbirdFolderMessagesForSync(
        folder,
        input.daysBack ?? 45,
        input.maxMessagesPerFolder ?? 250
      );
      let importedForFolder = 0;

      for (const summary of folderSync.messages) {
        const detail = await getThunderbirdMessageDetail(summary.id, summary.folderPath);
        let rawHeaders: Map<string, string> | null = null;

        if (needsRawHeaderFallback(detail)) {
          const rawMessage = await getThunderbirdRawMessage(summary.id, summary.folderPath, 250000);
          rawHeaders = parseRawHeaders(rawMessage.source);
        }

        const normalized = normalizedMessageFromThunderbird({
          messageId: summary.id,
          folderPath: summary.folderPath,
          folderType: folder.type,
          mailboxEmail,
          mailboxName: mailboxDisplayName,
          accountId: detail.accountId,
          threadId: detail.threadId,
          references: detail.references,
          inReplyTo: detail.inReplyTo,
          author: detail.author ?? summary.author ?? rawHeaderValue(rawHeaders ?? new Map(), "from"),
          recipients: detail.recipients ?? summary.recipients ?? rawHeaderValue(rawHeaders ?? new Map(), "to"),
          ccList: detail.ccList ?? summary.ccList ?? rawHeaderValue(rawHeaders ?? new Map(), "cc"),
          subject: detail.subject ?? summary.subject ?? rawHeaderValue(rawHeaders ?? new Map(), "subject"),
          date: detail.date ?? summary.date ?? rawHeaderValue(rawHeaders ?? new Map(), "date"),
          body: detail.body,
          read: detail.read,
          attachments: detail.attachments
        });

        await ingestNormalizedMessage(mailboxRecord, normalized);
        importedMessages += 1;
        importedForFolder += 1;
      }

      syncedFolders.push({
        path: folder.path,
        name: folder.name,
        type: folder.type,
        availableMessages: folderSync.stats.totalMessages,
        importedMessages: importedForFolder,
        unreadMessages: folderSync.stats.unreadMessages
      });
    }

    await prisma.thread.deleteMany({
      where: {
        mailboxId: mailbox.id,
        messages: {
          none: {}
        }
      }
    });

    const syncSource = await prisma.thunderbirdSyncSource.upsert({
      where: {
        mailboxId: mailbox.id
      },
      update: {
        thunderbirdAccountId: thunderbirdAccount.id,
        thunderbirdAccountName: thunderbirdAccount.name,
        thunderbirdIdentityId: defaultIdentity?.id ?? null,
        thunderbirdIdentityEmail: normalizeAddress(defaultIdentity?.email) || null,
        thunderbirdIdentityName: defaultIdentity?.name?.trim() || null,
        daysBack: input.daysBack ?? 45,
        maxMessagesPerFolder: input.maxMessagesPerFolder ?? 250,
        enabled: input.enabled ?? true,
        lastSyncedAt: new Date(),
        lastSyncError: null
      },
      create: {
        mailboxId: mailbox.id,
        thunderbirdAccountId: thunderbirdAccount.id,
        thunderbirdAccountName: thunderbirdAccount.name,
        thunderbirdIdentityId: defaultIdentity?.id ?? null,
        thunderbirdIdentityEmail: normalizeAddress(defaultIdentity?.email) || null,
        thunderbirdIdentityName: defaultIdentity?.name?.trim() || null,
        daysBack: input.daysBack ?? 45,
        maxMessagesPerFolder: input.maxMessagesPerFolder ?? 250,
        enabled: input.enabled ?? true,
        lastSyncedAt: new Date(),
        lastSyncError: null
      }
    });

    await prisma.mailbox.update({
      where: {
        id: mailbox.id
      },
      data: {
        lastSyncedAt: syncSource.lastSyncedAt,
        lastSyncError: null
      }
    });

    return {
      account: archiveAccount,
      mailbox: mailboxRecord,
      importedMessages,
      folders: syncedFolders,
      syncSource
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Thunderbird sync failed.";

    await prisma.thunderbirdSyncSource.upsert({
      where: {
        mailboxId: mailbox.id
      },
      update: {
        thunderbirdAccountId: thunderbirdAccount.id,
        thunderbirdAccountName: thunderbirdAccount.name,
        thunderbirdIdentityId: defaultIdentity?.id ?? null,
        thunderbirdIdentityEmail: normalizeAddress(defaultIdentity?.email) || null,
        thunderbirdIdentityName: defaultIdentity?.name?.trim() || null,
        daysBack: input.daysBack ?? 45,
        maxMessagesPerFolder: input.maxMessagesPerFolder ?? 250,
        enabled: input.enabled ?? true,
        lastSyncError: message
      },
      create: {
        mailboxId: mailbox.id,
        thunderbirdAccountId: thunderbirdAccount.id,
        thunderbirdAccountName: thunderbirdAccount.name,
        thunderbirdIdentityId: defaultIdentity?.id ?? null,
        thunderbirdIdentityEmail: normalizeAddress(defaultIdentity?.email) || null,
        thunderbirdIdentityName: defaultIdentity?.name?.trim() || null,
        daysBack: input.daysBack ?? 45,
        maxMessagesPerFolder: input.maxMessagesPerFolder ?? 250,
        enabled: input.enabled ?? true,
        lastSyncError: message
      }
    });

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

export async function syncAllThunderbirdDiscoveredMailboxes(input?: {
  daysBack?: number;
  maxMessagesPerFolder?: number;
}) {
  const discovered = await listThunderbirdDiscoveredMailboxes();
  const results = [];

  for (const mailbox of discovered) {
    results.push(
      await syncThunderbirdAccountIntoWorkbench({
        thunderbirdAccountId: mailbox.thunderbirdAccountId,
        mailboxEmail: mailbox.mailboxEmail,
        mailboxDisplayName: mailbox.mailboxDisplayName,
        daysBack: input?.daysBack ?? 45,
        maxMessagesPerFolder: input?.maxMessagesPerFolder ?? 250,
        enabled: true
      })
    );
  }

  return results;
}

export async function syncDueThunderbirdSources() {
  const env = getEnv();
  const cutoff = new Date(Date.now() - env.THUNDERBIRD_SYNC_INTERVAL_SECONDS * 1000);

  const dueSources = await prisma.thunderbirdSyncSource.findMany({
    where: {
      enabled: true,
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
    },
    include: {
      mailbox: true
    }
  });

  for (const source of dueSources) {
    try {
      await syncThunderbirdAccountIntoWorkbench({
        thunderbirdAccountId: source.thunderbirdAccountId,
        mailboxEmail: source.mailbox.emailAddress,
        mailboxDisplayName: source.mailbox.displayName,
        daysBack: source.daysBack,
        maxMessagesPerFolder: source.maxMessagesPerFolder,
        enabled: source.enabled
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Thunderbird scheduled sync failed.";

      await prisma.thunderbirdSyncSource.update({
        where: {
          id: source.id
        },
        data: {
          lastSyncError: message
        }
      });

      await prisma.mailbox.update({
        where: {
          id: source.mailboxId
        },
        data: {
          lastSyncError: message
        }
      });
    }
  }

  return dueSources.length;
}
