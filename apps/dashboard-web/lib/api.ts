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
  provider: "MICROSOFT" | "ARCHIVE" | "APPLE_MAIL";
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
  archivedAt?: string | null;
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

export type ThreadAssistantResponse = {
  routing: {
    category: ModelSourceCategory;
    providerId: string;
    providerLabel: string;
    defaultModel: string;
    routingMode: RoutingMode;
    analyticsMode: "DETERMINISTIC_ONLY";
  };
  briefing: {
    summary: string;
    whyItMatters: string;
    suggestedNextStep: string;
    replySignal: string;
    latestMessageAt: string;
  };
  draftSuggestions: Array<{
    id: string;
    label: string;
    subject: string;
    body: string;
  }>;
};

export type ThreadActionResult = {
  thread: {
    id: string;
    unreadCount: number;
    archivedAt: string | null;
  };
};

export type ThreadFollowUpActionResult = {
  task: {
    id: string;
    title: string;
    dueAt: string;
    note: string | null;
    status: "PENDING" | "COMPLETED" | "CANCELED";
  };
};

export type OrganizationActivityItem = {
  organizationId: string;
  name: string;
  primaryDomain: string | null;
  kind: "INTERNAL" | "CLIENT" | "VENDOR" | "LEAD" | "UNKNOWN";
  inferredKind: "INTERNAL" | "CLIENT" | "VENDOR" | "LEAD" | "UNKNOWN";
  dominantCategory: "CLIENT" | "LEAD" | "VENDOR" | "INTERNAL" | "BILLING" | "SUPPORT" | "NEWSLETTER" | "NOTIFICATION" | null;
  threadCount: number;
  messageCount: number;
  inboundMessageCount: number;
  outboundMessageCount: number;
  uniqueContactCount: number;
  lastMessageAt: string | null;
};

export type OrganizationActivityReport = {
  window: {
    months: number;
    startAt: string;
    endAt: string;
  };
  summary: {
    organizationCount: number;
    threadCount: number;
    messageCount: number;
    inboundMessageCount: number;
    outboundMessageCount: number;
    uniqueContactCount: number;
  };
  organizations: OrganizationActivityItem[];
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
  setupSteps?: string[];
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

export type AppleMailStatus = {
  available: boolean;
  authenticated: boolean;
  authServerReachable: boolean;
  bridgeUrl: string;
  accountCount: number;
  error?: string;
  setupSteps?: string[];
};

export type AppleMailAccount = {
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

export type AppleMailFolder = {
  name: string;
  path: string;
  type: string;
  accountId: string;
  totalMessages: number;
  unreadMessages: number;
  depth: number;
};

export type AppleMailMessageSummary = {
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

export type AppleMailMessageDetail = AppleMailMessageSummary & {
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

export type AppleMailSyncResult = {
  syncs: Array<{
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
  body: string;
  bodyIsHtml: boolean;
  attachments: Array<{
    name: string;
    contentType: string;
    size: number | null;
  }>;
};

export type ThunderbirdSyncResult = {
  sync: {
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
};

export type ThunderbirdDiscoveredMailbox = {
  thunderbirdAccountId: string;
  thunderbirdAccountName: string;
  thunderbirdIdentityId: string | null;
  thunderbirdIdentityEmail: string | null;
  thunderbirdIdentityName: string | null;
  mailboxEmail: string;
  mailboxDisplayName: string;
  kind: "PRIMARY" | "SHARED";
  isTeamMailbox: boolean;
};

export type ThunderbirdSyncSource = {
  id: string;
  mailboxId: string;
  thunderbirdAccountId: string;
  thunderbirdAccountName: string;
  thunderbirdIdentityId: string | null;
  thunderbirdIdentityEmail: string | null;
  thunderbirdIdentityName: string | null;
  daysBack: number;
  maxMessagesPerFolder: number;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  mailbox: {
    id: string;
    emailAddress: string;
    displayName: string;
    kind: "PRIMARY" | "SHARED";
    role: "PERSONAL" | "SHARED" | "TEAM";
  };
};

export type ModelSourceCategory = "LOCAL_PROVIDER" | "CLOUD_API_TOKEN" | "COMPANION_ASSISTANT";
export type RoutingMode = "AUTO" | "EXPLICIT";
export type OAuthConnectionStatus = "NOT_CONNECTED" | "CONNECTED" | "COMING_SOON";

export type ModelsSettings = {
  enrichmentSource: {
    category: ModelSourceCategory;
    providerId: string;
    baseUrl: string | null;
    defaultModel: string;
    routingMode: RoutingMode;
    apiToken: string;
    apiTokenPreview?: string | null;
    hasApiToken?: boolean;
    oauthStatus: OAuthConnectionStatus;
    oauthAccountLabel: string | null;
  };
  analyticsMode: "DETERMINISTIC_ONLY";
};

export type AccountsSettings = {
  preferredLiveSource: "APPLE_MAIL" | "MICROSOFT_GRAPH" | "OUTLOOK_MCP" | "THUNDERBIRD";
  includeSharedMailboxesInQueues: boolean;
  prioritizeSharedMailboxes: boolean;
  defaultSyncWindowDays: number;
};

export type WorkflowsSettings = {
  replyQueueDefault: "needsReply" | "waitingOnThem" | "allThreads";
  followUpSlaHours: number;
  stackToasts: boolean;
  keyboardHints: boolean;
};

export type SettingsPayload = {
  models: ModelsSettings;
  accounts: AccountsSettings;
  workflows: WorkflowsSettings;
};

export type ModelProvider = {
  id: string;
  name: string;
  category: ModelSourceCategory;
  defaultBaseUrl: string | null;
  supportsBaseUrl: boolean;
  supportsApiToken: boolean;
  supportsOAuth: boolean;
  oauthStatus?: OAuthConnectionStatus;
};

export type ModelProviderCatalog = {
  providers: ModelProvider[];
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

export function getOutlookMcpConnectUrl() {
  return `${getApiBaseUrl()}/v1/outlook-mcp/auth/start`;
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

export async function fetchThreadAssistant(threadId: string) {
  const payload = await apiFetch<{
    assistant: {
      modelRouting: {
        category: ModelSourceCategory;
        providerId: string;
        defaultModel: string;
        routingMode: RoutingMode;
        analyticsMode: "DETERMINISTIC_ONLY";
      };
      groundedThreadIntelligence: {
        conciseSummary: string;
        whyItMatters: string;
        suggestedNextStep: {
          label: string;
        };
        followUpSignal: {
          status: string;
        };
        draftVariants: Array<{
          id: string;
          label: string;
          body: string;
        }>;
        context: {
          latestInboundAt: string | null;
          latestOutboundAt: string | null;
        };
      };
    };
  }>(`/v1/threads/${threadId}/assistant`);

  return {
    routing: {
      ...payload.assistant.modelRouting,
      providerLabel: payload.assistant.modelRouting.providerId
        .split("-")
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(" ")
    },
    briefing: {
      summary: payload.assistant.groundedThreadIntelligence.conciseSummary,
      whyItMatters: payload.assistant.groundedThreadIntelligence.whyItMatters,
      suggestedNextStep: payload.assistant.groundedThreadIntelligence.suggestedNextStep.label,
      replySignal: payload.assistant.groundedThreadIntelligence.followUpSignal.status.replace(/_/g, " ").toLowerCase(),
      latestMessageAt:
        payload.assistant.groundedThreadIntelligence.context.latestInboundAt ??
        payload.assistant.groundedThreadIntelligence.context.latestOutboundAt ??
        new Date().toISOString()
    },
    draftSuggestions: payload.assistant.groundedThreadIntelligence.draftVariants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      subject: variant.label,
      body: variant.body
    }))
  } satisfies ThreadAssistantResponse;
}

export async function setThreadReadState(threadId: string, read: boolean) {
  return apiFetch<{
    thread: ThreadActionResult["thread"];
  }>(`/v1/threads/${threadId}/actions/${read ? "mark-read" : "mark-unread"}`, {
    method: "POST",
  }).then((payload) => ({
    thread: payload.thread
  }));
}

export async function setThreadArchivedState(threadId: string, archived: boolean) {
  return apiFetch<{
    thread: ThreadActionResult["thread"];
  }>(`/v1/threads/${threadId}/actions/${archived ? "archive" : "unarchive"}`, {
    method: "POST"
  }).then((payload) => ({
    thread: payload.thread
  }));
}

export async function createThreadFollowUp(threadId: string, payload: { dueAt: string; note?: string; title?: string }) {
  return apiFetch<{
    thread: ThreadActionResult["thread"];
    followUpTask: ThreadFollowUpActionResult["task"];
  }>(`/v1/threads/${threadId}/actions/follow-up`, {
    method: "POST",
    body: JSON.stringify(payload)
  }).then((response) => ({
    task: response.followUpTask
  }));
}

export async function fetchWorkbench(mailboxId?: string) {
  const query = mailboxId ? `?mailboxId=${encodeURIComponent(mailboxId)}` : "";
  return apiFetch<WorkbenchData>(`/v1/workbench${query}`);
}

export async function fetchOrganizationActivity(months = 4, limit = 25, mailboxId?: string) {
  const params = new URLSearchParams({
    months: String(months),
    limit: String(limit)
  });

  if (mailboxId) {
    params.set("mailboxId", mailboxId);
  }

  return apiFetch<OrganizationActivityReport>(`/v1/analytics/organizations/activity?${params.toString()}`);
}

export async function fetchThunderbirdStatus() {
  return apiFetch<ThunderbirdStatus>("/v1/thunderbird/status");
}

export async function fetchOutlookMcpStatus() {
  return apiFetch<OutlookMcpStatus>("/v1/outlook-mcp/status");
}

export async function fetchAppleMailStatus() {
  return apiFetch<AppleMailStatus>("/v1/apple-mail/status");
}

export async function fetchAppleMailAccounts() {
  return apiFetch<{ accounts: AppleMailAccount[] }>("/v1/apple-mail/accounts");
}

export async function fetchAppleMailFolders(accountId?: string) {
  const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return apiFetch<{ folders: AppleMailFolder[] }>(`/v1/apple-mail/folders${query}`);
}

export async function fetchAppleMailRecentMessages(folderPath?: string, accountId?: string, recentDays?: number) {
  const params = new URLSearchParams({
    maxResults: "60"
  });

  if (folderPath) {
    params.set("folderPath", folderPath);
  }

  if (accountId) {
    params.set("accountId", accountId);
  }

  if (recentDays) {
    params.set("recentDays", String(recentDays));
  }

  return apiFetch<{ messages: AppleMailMessageSummary[] }>(`/v1/apple-mail/messages/recent?${params.toString()}`);
}

export async function fetchAppleMailMessage(messageId: string, folderPath?: string) {
  const params = new URLSearchParams({
    messageId
  });

  if (folderPath) {
    params.set("folderPath", folderPath);
  }

  return apiFetch<{ message: AppleMailMessageDetail }>(`/v1/apple-mail/messages/detail?${params.toString()}`);
}

export async function syncAppleMailAccount(payload: {
  accountId: string;
  maxMessagesPerFolder?: number;
  recentDays?: number;
}) {
  return apiFetch<AppleMailSyncResult>("/v1/apple-mail/sync", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function syncAllAppleMailAccounts(payload?: {
  maxMessagesPerFolder?: number;
  recentDays?: number;
}) {
  return apiFetch<AppleMailSyncResult>("/v1/apple-mail/sync-all", {
    method: "POST",
    body: JSON.stringify(payload ?? {})
  });
}

export async function ingestAppleMailAccount(payload: {
  account: AppleMailAccount;
  folders: AppleMailFolder[];
  messagesByFolder: Array<{
    folderPath: string;
    messages: AppleMailMessageSummary[];
  }>;
}) {
  return apiFetch<AppleMailSyncResult>("/v1/apple-mail/ingest", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function searchAppleMailMessages(query: string, folderPath?: string, accountId?: string) {
  const params = new URLSearchParams({
    query,
    maxResults: "60"
  });

  if (folderPath) {
    params.set("folderPath", folderPath);
  }

  if (accountId) {
    params.set("accountId", accountId);
  }

  return apiFetch<{ messages: AppleMailMessageSummary[] }>(`/v1/apple-mail/messages/search?${params.toString()}`);
}

export async function fetchOutlookMcpAccounts() {
  return apiFetch<{ accounts: OutlookMcpAccount[] }>("/v1/outlook-mcp/accounts");
}

export async function fetchOutlookMcpFolders() {
  return apiFetch<{ folders: OutlookMcpFolder[] }>("/v1/outlook-mcp/folders");
}

export async function fetchOutlookMcpRecentMessages(folderPath?: string) {
  const params = new URLSearchParams({
    daysBack: "14",
    maxResults: "60"
  });

  if (folderPath) {
    params.set("folderPath", folderPath);
  }

  return apiFetch<{ messages: OutlookMcpMessageSummary[] }>(
    `/v1/outlook-mcp/messages/recent?${params.toString()}`
  );
}

export async function fetchOutlookMcpMessage(messageId: string, folderPath?: string) {
  const params = new URLSearchParams({
    messageId
  });

  if (folderPath) {
    params.set("folderPath", folderPath);
  }

  return apiFetch<{ message: OutlookMcpMessageDetail }>(`/v1/outlook-mcp/messages/detail?${params.toString()}`);
}

export async function searchOutlookMcpMessages(query: string, folderPath?: string) {
  const params = new URLSearchParams({
    query,
    maxResults: "60"
  });

  if (folderPath) {
    params.set("folderPath", folderPath);
  }

  return apiFetch<{ messages: OutlookMcpMessageSummary[] }>(`/v1/outlook-mcp/messages/search?${params.toString()}`);
}

export async function fetchThunderbirdDiscoveredMailboxes() {
  return apiFetch<{ mailboxes: ThunderbirdDiscoveredMailbox[] }>("/v1/thunderbird/discovered-mailboxes");
}

export async function fetchThunderbirdSyncSources() {
  return apiFetch<{ sources: ThunderbirdSyncSource[] }>("/v1/thunderbird/sources");
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

export async function syncThunderbirdMailbox(payload: {
  thunderbirdAccountId: string;
  mailboxEmail?: string;
  mailboxDisplayName?: string;
  daysBack?: number;
  maxMessagesPerFolder?: number;
}) {
  return apiFetch<ThunderbirdSyncResult>("/v1/thunderbird/sync", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function syncAllThunderbirdMailboxes(payload?: {
  daysBack?: number;
  maxMessagesPerFolder?: number;
}) {
  return apiFetch<{ syncs: ThunderbirdSyncResult["sync"][] }>("/v1/thunderbird/sync-all", {
    method: "POST",
    body: JSON.stringify(payload ?? {})
  });
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

function normalizeModelsSettings(settings: Omit<ModelsSettings, "enrichmentSource"> & {
  enrichmentSource: Omit<ModelsSettings["enrichmentSource"], "apiToken" | "oauthStatus" | "oauthAccountLabel"> & {
    apiTokenPreview?: string | null;
    hasApiToken?: boolean;
    oauthStatus?: OAuthConnectionStatus;
    oauthAccountLabel?: string | null;
  };
}) {
  return {
    ...settings,
    enrichmentSource: {
      ...settings.enrichmentSource,
      apiToken: "",
      oauthStatus: settings.enrichmentSource.oauthStatus ?? "NOT_CONNECTED",
      oauthAccountLabel: settings.enrichmentSource.oauthAccountLabel ?? null
    }
  } satisfies ModelsSettings;
}

function normalizeSettingsPayload(payload: {
  settings: {
    models: Omit<ModelsSettings, "enrichmentSource"> & {
      enrichmentSource: Omit<ModelsSettings["enrichmentSource"], "apiToken" | "oauthStatus" | "oauthAccountLabel"> & {
        apiTokenPreview?: string | null;
        hasApiToken?: boolean;
        oauthStatus?: OAuthConnectionStatus;
        oauthAccountLabel?: string | null;
      };
    };
    accounts: AccountsSettings;
    workflows: WorkflowsSettings;
  };
}) {
  return {
    settings: {
      ...payload.settings,
      models: normalizeModelsSettings(payload.settings.models)
    }
  };
}

export async function queueSync(accountId: string) {
  return apiFetch<{ queued: number }>(`/v1/mail/accounts/${accountId}/sync`, {
    method: "POST"
  });
}

export async function fetchSettings() {
  const payload = await apiFetch<{
    settings: {
      models: Omit<ModelsSettings, "enrichmentSource"> & {
        enrichmentSource: Omit<ModelsSettings["enrichmentSource"], "apiToken" | "oauthStatus" | "oauthAccountLabel"> & {
          apiTokenPreview?: string | null;
          hasApiToken?: boolean;
          oauthStatus?: OAuthConnectionStatus;
          oauthAccountLabel?: string | null;
        };
      };
      accounts: AccountsSettings;
      workflows: WorkflowsSettings;
    };
  }>("/v1/settings");

  return normalizeSettingsPayload(payload);
}

export async function fetchModelProviderCatalog() {
  return apiFetch<ModelProviderCatalog>("/v1/model-providers");
}

export async function updateModelsSettings(settings: ModelsSettings) {
  const payload = await apiFetch<{
    settings: Omit<ModelsSettings, "enrichmentSource"> & {
      enrichmentSource: Omit<ModelsSettings["enrichmentSource"], "apiToken" | "oauthStatus" | "oauthAccountLabel"> & {
        apiTokenPreview?: string | null;
        hasApiToken?: boolean;
        oauthStatus?: OAuthConnectionStatus;
        oauthAccountLabel?: string | null;
      };
    };
  }>("/v1/settings/models", {
    method: "PUT",
    body: JSON.stringify({ settings })
  });

  return {
    settings: normalizeModelsSettings(payload.settings)
  };
}

export async function updateAccountsSettings(settings: AccountsSettings) {
  return apiFetch<{ settings: AccountsSettings }>("/v1/settings/accounts", {
    method: "PUT",
    body: JSON.stringify({ settings })
  });
}

export async function updateWorkflowsSettings(settings: WorkflowsSettings) {
  return apiFetch<{ settings: WorkflowsSettings }>("/v1/settings/workflows", {
    method: "PUT",
    body: JSON.stringify({ settings })
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
