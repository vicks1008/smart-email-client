const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export type AccountSummary = {
  id: string;
  provider: "MICROSOFT" | "ARCHIVE";
  email: string;
  displayName: string | null;
  status: "ACTIVE" | "NEEDS_REAUTH" | "DISCONNECTED";
  mailboxes: Array<{
    id: string;
    displayName: string;
    emailAddress: string;
    kind: "PRIMARY" | "SHARED";
    lastSyncedAt: string | null;
    lastSyncError: string | null;
    _count: {
      threads: number;
      messages: number;
    };
  }>;
  importJobs: Array<{
    id: string;
    format: "EML" | "OLM";
    sourceFilename: string;
    importedMessages: number;
    status: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
    errorText: string | null;
    createdAt: string;
    finishedAt: string | null;
  }>;
};

export type ThreadSummary = {
  id: string;
  mailboxId: string;
  subject: string;
  participants: Array<{ address: string; name: string }>;
  unreadCount: number;
  lastMessageAt: string;
  mailbox: {
    id: string;
    emailAddress: string;
    displayName: string;
    kind: "PRIMARY" | "SHARED";
  };
  latestMessage: {
    id: string;
    fromName: string | null;
    fromAddress: string | null;
    bodyPreview: string;
    receivedAt: string;
    isRead: boolean;
    hasAttachments: boolean;
    importance: string | null;
  } | null;
};

export type ThreadDetail = {
  id: string;
  subject: string;
  participants: Array<{ address: string; name: string }>;
  unreadCount: number;
  lastMessageAt: string;
  mailbox: {
    id: string;
    displayName: string;
    emailAddress: string;
    kind: "PRIMARY" | "SHARED";
  };
  messages: Array<{
    id: string;
    subject: string;
    fromName: string | null;
    fromAddress: string | null;
    toRecipients: Array<{ address: string; name: string }>;
    ccRecipients: Array<{ address: string; name: string }>;
    receivedAt: string;
    sentAt: string | null;
    bodyPreview: string;
    bodyText: string;
    bodyHtml: string | null;
    webLink: string | null;
    isRead: boolean;
    hasAttachments: boolean;
    importance: string | null;
  }>;
};

export type ImportJobSummary = {
  id: string;
  format: "EML" | "OLM";
  sourceFilename: string;
  importedMessages: number;
  status: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  errorText: string | null;
  createdAt: string;
  finishedAt: string | null;
  mailbox: {
    id: string;
    emailAddress: string;
    displayName: string;
    kind: "PRIMARY" | "SHARED";
  };
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
  bundledXpiDetected?: boolean;
  extensionXpiPath?: string | null;
  setupSteps?: string[];
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

export type ThunderbirdMessageDetail = ThunderbirdMessageSummary & {
  body: string;
  bodyIsHtml: boolean;
  attachments: Array<{
    name: string;
    contentType: string;
    size: number | null;
  }>;
};

async function apiFetch<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export function getMicrosoftConnectUrl(redirectUrl: string) {
  return `${API_BASE_URL}/v1/auth/microsoft/start?redirect=${encodeURIComponent(redirectUrl)}`;
}

export async function fetchAccounts() {
  return apiFetch<{ accounts: AccountSummary[] }>("/v1/mail/accounts");
}

export async function fetchThreads(mailboxId?: string) {
  const query = mailboxId ? `?mailboxId=${encodeURIComponent(mailboxId)}` : "";
  return apiFetch<{ threads: ThreadSummary[] }>(`/v1/threads${query}`);
}

export async function fetchThread(threadId: string) {
  return apiFetch<{ thread: ThreadDetail }>(`/v1/threads/${threadId}`);
}

export async function fetchThunderbirdStatus() {
  return apiFetch<ThunderbirdStatus>("/v1/thunderbird/status");
}

export async function fetchThunderbirdAccounts() {
  return apiFetch<{ accounts: ThunderbirdAccount[] }>("/v1/thunderbird/accounts");
}

export async function fetchThunderbirdFolders(accountId?: string) {
  const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return apiFetch<{ folders: ThunderbirdFolder[] }>(`/v1/thunderbird/folders${query}`);
}

export async function fetchThunderbirdRecentMessages(folderPath?: string) {
  const params = new URLSearchParams({
    daysBack: "14",
    maxResults: "60"
  });

  if (folderPath) {
    params.set("folderPath", folderPath);
  }

  return apiFetch<{ messages: ThunderbirdMessageSummary[] }>(
    `/v1/thunderbird/messages/recent?${params.toString()}`
  );
}

export async function fetchThunderbirdMessage(messageId: string, folderPath: string) {
  const params = new URLSearchParams({
    messageId,
    folderPath
  });

  return apiFetch<{ message: ThunderbirdMessageDetail }>(
    `/v1/thunderbird/messages/detail?${params.toString()}`
  );
}

export async function searchThunderbirdMessages(query: string, folderPath?: string) {
  const params = new URLSearchParams({
    query,
    maxResults: "60"
  });

  if (folderPath) {
    params.set("folderPath", folderPath);
  }

  return apiFetch<{ messages: ThunderbirdMessageSummary[] }>(
    `/v1/thunderbird/messages/search?${params.toString()}`
  );
}

export async function fetchImports(mailboxId?: string, accountId?: string) {
  const params = new URLSearchParams();
  if (mailboxId) {
    params.set("mailboxId", mailboxId);
  }
  if (accountId) {
    params.set("accountId", accountId);
  }

  const query = params.toString();
  return apiFetch<{ imports: ImportJobSummary[] }>(`/v1/imports${query ? `?${query}` : ""}`);
}

export async function queueSync(accountId: string) {
  return apiFetch<{ queued: number }>(`/v1/mail/accounts/${accountId}/sync`, {
    method: "POST"
  });
}

export async function addSharedMailbox(accountId: string, payload: { emailAddress: string; displayName?: string }) {
  return apiFetch<{ mailbox: AccountSummary["mailboxes"][number] }>(
    `/v1/mail/accounts/${accountId}/mailboxes`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export async function uploadArchive(payload: {
  file: File;
  accountId?: string;
  mailboxId?: string;
  mailboxEmail?: string;
  mailboxDisplayName?: string;
}) {
  const formData = new FormData();
  formData.append("file", payload.file);

  if (payload.accountId) {
    formData.append("accountId", payload.accountId);
  }

  if (payload.mailboxId) {
    formData.append("mailboxId", payload.mailboxId);
  }

  if (payload.mailboxEmail) {
    formData.append("mailboxEmail", payload.mailboxEmail);
  }

  if (payload.mailboxDisplayName) {
    formData.append("mailboxDisplayName", payload.mailboxDisplayName);
  }

  const response = await fetch(`${API_BASE_URL}/v1/imports`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `Request failed with ${response.status}`);
  }

  return (await response.json()) as { importJob: ImportJobSummary };
}
