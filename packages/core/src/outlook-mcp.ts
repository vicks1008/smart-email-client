import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { getMicrosoftProfile, type GraphRecipient } from "./microsoft";
import { getEnv } from "./env";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const DEFAULT_TOKEN_STORE_PATH = join(homedir(), ".outlook-mcp-tokens.json");
const DEFAULT_SCOPES = [
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Mail.ReadWrite",
  "Mail.Read.Shared",
  "Mail.ReadWrite.Shared",
  "Mail.Send"
];

type OutlookMcpTokenStore = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

type GraphFolder = {
  id: string;
  displayName: string;
  parentFolderId?: string | null;
  childFolderCount?: number | null;
  totalItemCount?: number | null;
  unreadItemCount?: number | null;
};

type GraphFolderListResponse = {
  value?: GraphFolder[];
};

type GraphMessage = {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  body?: {
    contentType?: string | null;
    content?: string | null;
  } | null;
  from?: GraphRecipient | null;
  toRecipients?: GraphRecipient[] | null;
  ccRecipients?: GraphRecipient[] | null;
  receivedDateTime?: string | null;
  isRead?: boolean | null;
  hasAttachments?: boolean | null;
  importance?: string | null;
  internetMessageHeaders?: Array<{
    name?: string | null;
    value?: string | null;
  }> | null;
  conversationId?: string | null;
  categories?: string[] | null;
  parentFolderId?: string | null;
};

type GraphMessageListResponse = {
  value?: GraphMessage[];
};

type GraphAttachmentListResponse = {
  value?: Array<{
    id?: string;
    name?: string | null;
    contentType?: string | null;
    size?: number | null;
  }>;
};

export type OutlookMcpStatus = {
  available: boolean;
  authenticated: boolean;
  authServerReachable: boolean;
  bridgeUrl: string;
  tokenStorePath: string;
  serverInfo?: {
    name: string;
    version: string;
  };
  error?: string;
};

export type OutlookMcpAccount = {
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

export type OutlookMcpFolder = {
  name: string;
  path: string;
  type: string;
  accountId: string;
  totalMessages: number;
  unreadMessages: number;
  depth: number;
};

export type OutlookMcpMessageSummary = {
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

export type OutlookMcpMessageDetail = OutlookMcpMessageSummary & {
  accountId: string | null;
  accountName: string | null;
  serverType: string | null;
  folderType: string | null;
  messageKey: number | null;
  threadId: string | null;
  threadParent: number | null;
  references: string[];
  inReplyTo: string | null;
  size: number | null;
  lineCount: number | null;
  priority: string | null;
  keywords: string;
  charset: string | null;
  body: string;
  bodyIsHtml: boolean;
  attachments: Array<{
    name: string;
    contentType: string;
    size: number | null;
  }>;
};

function getTokenStorePath() {
  const env = getEnv();
  return env.OUTLOOK_MCP_TOKEN_STORE_PATH ?? DEFAULT_TOKEN_STORE_PATH;
}

function getRefreshScopes() {
  const env = getEnv();
  return (env.OUTLOOK_MCP_SCOPES?.trim() || DEFAULT_SCOPES.join(" ")).trim();
}

function getAuthorityBase() {
  const env = getEnv();
  return `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0`;
}

function normalizeAddress(address?: string | null) {
  return address?.trim().toLowerCase() ?? "";
}

function formatRecipient(recipient?: GraphRecipient | null) {
  const address = recipient?.emailAddress?.address?.trim();
  const name = recipient?.emailAddress?.name?.trim();
  return name || address || "Unknown";
}

function joinRecipients(recipients?: GraphRecipient[] | null) {
  return (recipients ?? []).map((recipient) => formatRecipient(recipient)).filter(Boolean).join(", ");
}

function mapFolderType(name: string) {
  const normalized = name.trim().toLowerCase();
  if (normalized === "inbox") return "inbox";
  if (normalized === "sent items" || normalized === "sent") return "sent";
  if (normalized === "drafts") return "drafts";
  if (normalized === "deleted items" || normalized === "deleted") return "trash";
  if (normalized === "archive") return "archive";
  if (normalized === "junk email" || normalized === "junk") return "junk";
  return "custom";
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

function firstHeader(headers: GraphMessage["internetMessageHeaders"], targetName: string) {
  return (
    headers?.find((header) => header.name?.trim().toLowerCase() === targetName.toLowerCase())?.value?.trim() ?? null
  );
}

async function readTokenStore() {
  try {
    const raw = await readFile(getTokenStorePath(), "utf8");
    return JSON.parse(raw) as OutlookMcpTokenStore;
  } catch {
    return null;
  }
}

async function writeTokenStore(tokens: OutlookMcpTokenStore) {
  await writeFile(getTokenStorePath(), JSON.stringify(tokens, null, 2), {
    mode: 0o600
  });
}

function isTokenFresh(tokens: OutlookMcpTokenStore | null, bufferMs = 5 * 60 * 1000) {
  if (!tokens?.access_token) {
    return false;
  }

  if (!tokens.expires_at) {
    return false;
  }

  return Date.now() < tokens.expires_at - bufferMs;
}

async function refreshOutlookMcpAccessToken(existing: OutlookMcpTokenStore): Promise<string> {
  const env = getEnv();
  if (!existing.refresh_token) {
    throw new Error("Outlook MCP is not authenticated yet.");
  }

  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new Error("Microsoft OAuth credentials are not configured for Outlook MCP refresh.");
  }

  const formData = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    client_secret: env.MICROSOFT_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: existing.refresh_token,
    scope: getRefreshScopes()
  });

  const response = await fetch(`${getAuthorityBase()}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: formData
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Outlook MCP token refresh failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
  };

  const nextTokens: OutlookMcpTokenStore = {
    ...existing,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? existing.refresh_token,
    expires_in: payload.expires_in,
    expires_at: Date.now() + payload.expires_in * 1000,
    scope: payload.scope ?? existing.scope,
    token_type: payload.token_type ?? existing.token_type
  };

  await writeTokenStore(nextTokens);
  if (!nextTokens.access_token) {
    throw new Error("Outlook MCP refresh did not return an access token.");
  }

  return nextTokens.access_token;
}

async function getOutlookMcpAccessToken(): Promise<string> {
  const tokens = await readTokenStore();
  if (!tokens?.access_token) {
    throw new Error("Outlook MCP is not authenticated yet.");
  }

  if (isTokenFresh(tokens)) {
    return tokens.access_token;
  }

  return refreshOutlookMcpAccessToken(tokens);
}

async function graphRequest<T>(
  path: string,
  options?: {
    query?: Record<string, string | number | boolean | undefined>;
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    headers?: Record<string, string>;
    body?: unknown;
    retry?: boolean;
  }
) {
  const url = new URL(path.startsWith("http") ? path : `${GRAPH_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const accessToken = await getOutlookMcpAccessToken();
  const response = await fetch(url, {
    method: options?.method ?? "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...(options?.headers ?? {})
    },
    body: options?.body ? JSON.stringify(options.body) : undefined
  });

  if (response.status === 401 && options?.retry !== false) {
    await refreshOutlookMcpAccessToken((await readTokenStore()) ?? {});
    return graphRequest<T>(path, {
      ...options,
      retry: false
    });
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Outlook Graph request failed (${response.status}): ${body}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

async function flattenFolders(parentId?: string, depth = 0): Promise<OutlookMcpFolder[]> {
  const response = await graphRequest<GraphFolderListResponse>(
    parentId ? `/me/mailFolders/${encodeURIComponent(parentId)}/childFolders` : "/me/mailFolders",
    {
      query: {
        $top: 100,
        $select: "id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount"
      }
    }
  );

  const folders = response.value ?? [];
  const mapped = folders.map((folder) => ({
    name: folder.displayName,
    path: folder.id,
    type: mapFolderType(folder.displayName),
    accountId: "me",
    totalMessages: folder.totalItemCount ?? 0,
    unreadMessages: folder.unreadItemCount ?? 0,
    depth
  }));

  const descendants = await Promise.all(
    folders
      .filter((folder) => (folder.childFolderCount ?? 0) > 0)
      .map((folder) => flattenFolders(folder.id, depth + 1))
  );

  return [...mapped, ...descendants.flat()];
}

async function resolveFolder(folderPath?: string) {
  if (!folderPath) {
    return {
      folderId: "inbox",
      folderName: "Inbox",
      folderType: "inbox",
      endpoint: "/me/mailFolders/inbox/messages"
    };
  }

  const folder = await graphRequest<GraphFolder>(`/me/mailFolders/${encodeURIComponent(folderPath)}`, {
    query: {
      $select: "id,displayName"
    }
  });

  return {
    folderId: folder.id,
    folderName: folder.displayName,
    folderType: mapFolderType(folder.displayName),
    endpoint: `/me/mailFolders/${encodeURIComponent(folder.id)}/messages`
  };
}

function mapMessageSummary(message: GraphMessage, folder: { folderId: string; folderName: string }) {
  const author = formatRecipient(message.from);
  return {
    id: message.id,
    subject: message.subject?.trim() || "(no subject)",
    author,
    recipients: joinRecipients(message.toRecipients),
    ccList: joinRecipients(message.ccRecipients) || undefined,
    date: message.receivedDateTime ?? null,
    folder: folder.folderName,
    folderPath: folder.folderId,
    read: Boolean(message.isRead),
    flagged: false
  } satisfies OutlookMcpMessageSummary;
}

export async function getOutlookMcpStatus(): Promise<OutlookMcpStatus> {
  const env = getEnv();
  const tokenStorePath = getTokenStorePath();

  let authServerReachable = false;
  try {
    const response = await fetch(env.OUTLOOK_MCP_AUTH_SERVER_URL, {
      redirect: "manual"
    });
    authServerReachable = response.ok || response.status === 302;
  } catch {
    authServerReachable = false;
  }

  try {
    const accessToken = await getOutlookMcpAccessToken();
    const profile = await getMicrosoftProfile(accessToken);

    return {
      available: true,
      authenticated: true,
      authServerReachable,
      bridgeUrl: env.OUTLOOK_MCP_AUTH_SERVER_URL,
      tokenStorePath,
      serverInfo: {
        name: "Outlook MCP",
        version: profile.userPrincipalName ?? profile.mail ?? profile.id
      }
    };
  } catch (error) {
    return {
      available: false,
      authenticated: false,
      authServerReachable,
      bridgeUrl: env.OUTLOOK_MCP_AUTH_SERVER_URL,
      tokenStorePath,
      error: error instanceof Error ? error.message : "Outlook MCP is not available."
    };
  }
}

export async function outlookMcpSetupProbe() {
  const status = await getOutlookMcpStatus();
  const setupSteps = [
    "Run the local outlook-mcp auth server on http://localhost:3333.",
    "Add http://localhost:3333/auth/callback as a Web redirect URI in Azure.",
    "Use Connect Outlook MCP to sign in, then refresh the live workspace."
  ];

  try {
    await access(status.tokenStorePath, constants.F_OK);
  } catch {
    return {
      ...status,
      setupSteps
    };
  }

  return status;
}

export function getOutlookMcpAuthUrl() {
  const env = getEnv();
  return `${env.OUTLOOK_MCP_AUTH_SERVER_URL}/auth`;
}

export async function listOutlookMcpAccounts() {
  const accessToken = await getOutlookMcpAccessToken();
  const profile = await getMicrosoftProfile(accessToken);
  const email = profile.mail ?? profile.userPrincipalName ?? "";

  return [
    {
      id: "me",
      name: profile.displayName ?? email ?? "Microsoft 365",
      type: "OUTLOOK_MCP",
      identities: email
        ? [
            {
              id: profile.id,
              email,
              name: profile.displayName ?? email,
              isDefault: true
            }
          ]
        : []
    } satisfies OutlookMcpAccount
  ];
}

export async function listOutlookMcpFolders() {
  const folders = await flattenFolders();
  return folders.sort((left, right) => {
    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }

    return left.name.localeCompare(right.name);
  });
}

export async function getOutlookMcpRecentMessages(input: {
  folderPath?: string;
  daysBack?: number;
  maxResults?: number;
}) {
  const folder = await resolveFolder(input.folderPath);
  const response = await graphRequest<GraphMessageListResponse>(folder.endpoint, {
    query: {
      $top: Math.min(input.maxResults ?? 60, 100),
      $orderby: "receivedDateTime desc",
      $select:
        "id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,hasAttachments,importance,isRead,parentFolderId"
    }
  });

  return (response.value ?? []).map((message) => mapMessageSummary(message, folder));
}

export async function searchOutlookMcpMessages(input: {
  query: string;
  folderPath?: string;
  maxResults?: number;
}) {
  const trimmedQuery = input.query.trim();
  if (!trimmedQuery) {
    return getOutlookMcpRecentMessages({
      folderPath: input.folderPath,
      maxResults: input.maxResults
    });
  }

  const folder = await resolveFolder(input.folderPath);

  try {
    const response = await graphRequest<GraphMessageListResponse>(folder.endpoint, {
      query: {
        $top: Math.min(input.maxResults ?? 60, 100),
        $select:
          "id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,hasAttachments,importance,isRead,parentFolderId",
        $search: `"${trimmedQuery.replace(/"/g, '\\"')}"`
      },
      headers: {
        ConsistencyLevel: "eventual"
      }
    });

    return (response.value ?? []).map((message) => mapMessageSummary(message, folder));
  } catch {
    const recent = await getOutlookMcpRecentMessages({
      folderPath: input.folderPath,
      maxResults: input.maxResults
    });

    const lowerQuery = trimmedQuery.toLowerCase();
    return recent.filter((message) =>
      [message.subject, message.author, message.recipients, message.ccList ?? ""].join(" ").toLowerCase().includes(lowerQuery)
    );
  }
}

export async function getOutlookMcpMessageDetail(messageId: string, folderPath?: string) {
  const folder = await resolveFolder(folderPath);
  const [message, profile] = await Promise.all([
    graphRequest<GraphMessage>(`/me/messages/${encodeURIComponent(messageId)}`, {
      query: {
        $select:
          "id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments,importance,isRead,internetMessageHeaders,conversationId,categories,parentFolderId"
      }
    }),
    getMicrosoftProfile(await getOutlookMcpAccessToken())
  ]);

  const attachments = message.hasAttachments
    ? (
        await graphRequest<GraphAttachmentListResponse>(`/me/messages/${encodeURIComponent(messageId)}/attachments`, {
          query: {
            $select: "id,name,contentType,size"
          }
        })
      ).value ?? []
    : [];

  const bodyIsHtml = message.body?.contentType?.toLowerCase() === "html";
  const body = bodyIsHtml ? stripHtml(message.body?.content ?? "") : message.body?.content?.trim() || message.bodyPreview || "";

  return {
    ...mapMessageSummary(message, folder),
    accountId: "me",
    accountName: profile.displayName ?? profile.mail ?? profile.userPrincipalName ?? "Microsoft 365",
    serverType: "graph",
    folderType: folder.folderType,
    messageKey: null,
    threadId: message.conversationId ?? null,
    threadParent: null,
    references: [],
    inReplyTo: firstHeader(message.internetMessageHeaders, "in-reply-to"),
    size: null,
    lineCount: body ? body.split("\n").length : 0,
    priority: message.importance ?? null,
    keywords: (message.categories ?? []).join(","),
    charset: null,
    body,
    bodyIsHtml,
    attachments: attachments.map((attachment) => ({
      name: attachment.name ?? "attachment",
      contentType: attachment.contentType ?? "application/octet-stream",
      size: attachment.size ?? null
    }))
  } satisfies OutlookMcpMessageDetail;
}
