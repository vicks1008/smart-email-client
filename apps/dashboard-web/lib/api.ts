const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export type AccountSummary = {
  id: string;
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

export function getMicrosoftConnectUrl() {
  return `${API_BASE_URL}/v1/auth/microsoft/start?redirect=${encodeURIComponent("http://localhost:3000/mail")}`;
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
