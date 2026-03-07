function getApiBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

  if (typeof window === "undefined") {
    return configured;
  }

  try {
    const url = new URL(configured);
    url.hostname = window.location.hostname;
    return url.toString().replace(/\/$/, "");
  } catch {
    return configured;
  }
}

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
    role: "PERSONAL" | "SHARED" | "TEAM";
  };
  primaryOrganization: {
    id: string;
    name: string;
    kind: "INTERNAL" | "CLIENT" | "VENDOR" | "LEAD" | "UNKNOWN";
    primaryDomain: string | null;
  } | null;
  replyState: {
    status: "NEEDS_REPLY" | "WAITING_ON_THEM" | "CLOSED_LOOP" | "FOLLOW_UP_LATER";
    reason: string;
    confidence: number;
    needsReply: boolean;
    waitingOnThem: boolean;
    replyDueAt: string | null;
    staleAt: string | null;
    suggestedFollowUpAt: string | null;
    isOverdue: boolean;
  } | null;
  latestCategory: {
    label: "CLIENT" | "LEAD" | "VENDOR" | "INTERNAL" | "BILLING" | "SUPPORT" | "NEWSLETTER" | "NOTIFICATION";
    confidence: number;
    source: "DOMAIN" | "SIGNATURE" | "THREAD_HISTORY" | "HEURISTIC" | "MANUAL" | "MODEL";
  } | null;
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
    role: "PERSONAL" | "SHARED" | "TEAM";
  };
  replyState: ThreadSummary["replyState"];
  people: Array<{
    id: string;
    emailAddress: string;
    displayName: string | null;
    isMailbox: boolean;
    isSharedMailbox: boolean;
    organization: ThreadSummary["primaryOrganization"];
    contact: {
      id: string;
      displayName: string;
      roleTitle: string | null;
      isMailboxOwner: boolean;
      emailAddresses: string[];
    } | null;
  }>;
  followUpTasks: Array<{
    id: string;
    title: string;
    note: string | null;
    dueAt: string;
    status: "PENDING" | "COMPLETED" | "CANCELED";
  }>;
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
    category: ThreadSummary["latestCategory"];
  }>;
};

export type WorkbenchData = {
  summary: {
    needsReply: number;
    waitingOnThem: number;
    followUpToday: number;
    overdue: number;
  };
  needsReply: ThreadSummary[];
  waitingOnThem: ThreadSummary[];
  followUpToday: Array<{
    id: string;
    title: string;
    note: string | null;
    dueAt: string;
    mailbox: {
      id: string;
      emailAddress: string;
      displayName: string;
      role: "PERSONAL" | "SHARED" | "TEAM";
    };
    thread: {
      id: string;
      subject: string;
    };
    organization: {
      id: string;
      name: string;
      kind: "INTERNAL" | "CLIENT" | "VENDOR" | "LEAD" | "UNKNOWN";
    } | null;
    contact: {
      id: string;
      displayName: string;
    } | null;
  }>;
  byOrganization: Array<{
    id: string;
    name: string;
    kind: "INTERNAL" | "CLIENT" | "VENDOR" | "LEAD" | "UNKNOWN";
    primaryDomain: string | null;
    needsReply: number;
    waitingOnThem: number;
    followUps: number;
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
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
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
  return `${getApiBaseUrl()}/v1/auth/microsoft/start?redirect=${encodeURIComponent(redirectUrl)}`;
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

export async function fetchWorkbench(mailboxId?: string) {
  const query = mailboxId ? `?mailboxId=${encodeURIComponent(mailboxId)}` : "";
  return apiFetch<WorkbenchData>(`/v1/workbench${query}`);
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

  const response = await fetch(`${getApiBaseUrl()}/v1/imports`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `Request failed with ${response.status}`);
  }

  return (await response.json()) as { importJob: ImportJobSummary };
}
