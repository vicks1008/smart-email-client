"use client";

import { useRouter } from "next/navigation";
import {
  Archive,
  AtSign,
  BellRing,
  BrainCircuit,
  Building2,
  CircleUserRound,
  CheckCircle2,
  Command,
  Clock3,
  Copy,
  FolderArchive,
  FolderSync,
  Forward,
  Globe,
  Inbox,
  LoaderCircle,
  MailPlus,
  MapPin,
  MoreHorizontal,
  PanelLeft,
  PlugZap,
  RefreshCcw,
  Reply,
  ReplyAll,
  SendHorizontal,
  ShieldAlert,
  Upload,
} from "lucide-react";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent
} from "react";
import { toast } from "sonner";

import {
  backfillAppleMailAccount,
  addSharedMailbox,
  createThreadFollowUp,
  fetchAccounts,
  fetchAppleMailAccounts as fetchThunderbirdAccounts,
  fetchAppleMailFolders as fetchThunderbirdFolders,
  fetchAppleMailMessage as fetchThunderbirdMessage,
  fetchAppleMailRecentMessages as fetchThunderbirdRecentMessages,
  fetchAppleMailStatus as fetchThunderbirdStatus,
  fetchImports,
  fetchThreadAssistant,
  fetchThread,
  fetchThreads,
  fetchThunderbirdDiscoveredMailboxes,
  fetchThunderbirdSyncSources,
  fetchOrganizationActivity,
  fetchWorkbench,
  ingestAppleMailAccount,
  queueSync,
  setThreadArchivedState,
  setThreadReadState,
  searchAppleMailMessages as searchThunderbirdMessages,
  syncAllThunderbirdMailboxes,
  syncThunderbirdMailbox,
  uploadArchive,
  type AccountSummary,
  type AppleMailBackfillResult,
  type AppleMailAccount as ThunderbirdAccount,
  type AppleMailFolder as ThunderbirdFolder,
  type AppleMailMessageDetail as ThunderbirdMessageDetail,
  type AppleMailMessageSummary as ThunderbirdMessageSummary,
  type AppleMailStatus as ThunderbirdStatus,
  type ImportJobSummary,
  type ThreadAssistantResponse,
  type ThreadDetail,
  type ThreadSummary,
  type ThunderbirdDiscoveredMailbox,
  type ThunderbirdSyncSource,
  type OrganizationActivityItem,
  type OrganizationActivityReport,
  type WorkbenchData
} from "../lib/api";
import { AppShell } from "./app-shell";

type WorkspaceView = "inbox" | "accounts" | "followups" | "analytics" | "live";
type InboxQueue = "needsReply" | "waitingOnThem" | "allThreads";
type MailboxScope = "all" | "personal" | "shared";

type DraftTemplate = {
  id: string;
  label: string;
  body: string;
};

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatShortDate(value: string | null | undefined) {
  if (!value) {
    return "No deadline";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined).format(value);
}

function initials(value: string | null | undefined) {
  const base = (value ?? "").trim();
  if (!base) {
    return "SM";
  }

  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function emailDomain(value: string | null | undefined) {
  const address = value?.trim().toLowerCase() ?? "";
  const [, domain] = address.split("@");
  return domain ?? "";
}

function extractEmailAddress(value: string | null | undefined) {
  const input = value?.trim() ?? "";
  const match = input.match(/<([^>]+@[^>]+)>/);
  if (match?.[1]) {
    return match[1].trim().toLowerCase();
  }

  return input.includes("@") ? input.toLowerCase() : "";
}

function primaryThreadPerson(thread: ThreadDetail | null) {
  if (!thread) {
    return null;
  }

  return thread.people.find((person) => !person.isMailbox) ?? thread.people[0] ?? null;
}

function primaryThreadOrganization(thread: ThreadDetail | null) {
  if (!thread) {
    return null;
  }

  return primaryThreadPerson(thread)?.organization ?? null;
}

function monogram(value: string | null | undefined) {
  const cleaned = (value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .trim();

  if (!cleaned) {
    return "SM";
  }

  const parts = cleaned.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? parts[0]?.[1] ?? "";
  return `${first}${second}`.toUpperCase();
}

function seedLiveMessageDetail(
  message: ThunderbirdMessageSummary,
  accountName: string | null,
  folderType: string | null
): ThunderbirdMessageDetail {
  return {
    ...message,
    accountId: accountName,
    accountName,
    serverType: "apple-mail",
    folderType,
    messageKey: null,
    threadId: null,
    threadParent: null,
    references: [],
    inReplyTo: null,
    size: null,
    lineCount: null,
    priority: null,
    keywords: "",
    charset: null,
    body: "Loading message body...",
    bodyIsHtml: false,
    attachments: []
  };
}

function activityTone(kind: OrganizationActivityItem["inferredKind"]) {
  switch (kind) {
    case "CLIENT":
      return "active";
    case "LEAD":
      return "warning";
    default:
      return "neutral";
  }
}

function dominantCategoryLabel(category: OrganizationActivityItem["dominantCategory"]) {
  return category?.toLowerCase().replace(/_/g, " ") ?? "uncategorized";
}

function statusClass(status: AccountSummary["status"]) {
  return status === "ACTIVE" ? "active" : "warning";
}

function replyTone(state: ThreadSummary["replyState"] | ThreadDetail["replyState"]) {
  if (!state) {
    return "neutral";
  }

  if (state.needsReply && state.isOverdue) {
    return "danger";
  }

  if (state.needsReply || state.waitingOnThem) {
    return "warning";
  }

  return "active";
}

function replyLabel(state: ThreadSummary["replyState"] | ThreadDetail["replyState"]) {
  if (!state) {
    return "Unclassified";
  }

  switch (state.status) {
    case "NEEDS_REPLY":
      return state.isOverdue ? "Overdue reply" : "Needs reply";
    case "WAITING_ON_THEM":
      return "Waiting on client";
    case "FOLLOW_UP_LATER":
      return "Follow up later";
    case "CLOSED_LOOP":
    default:
      return "Closed loop";
  }
}

function categoryLabel(category: ThreadSummary["latestCategory"] | ThreadDetail["messages"][number]["category"]) {
  return category?.label.toLowerCase().replace(/_/g, " ") ?? "uncategorized";
}

function participantName(thread: ThreadDetail) {
  const mailboxEmail = thread.mailbox.emailAddress;
  const primaryPerson = thread.people.find((person) => !person.isMailbox)?.displayName;
  const firstExternalParticipant = thread.participants.find((participant) => participant.address !== mailboxEmail)?.name;
  const firstExternalMessage =
    thread.messages.find((message) => message.fromAddress && message.fromAddress !== mailboxEmail) ?? thread.messages[0];

  return (
    primaryPerson ??
    firstExternalMessage?.fromName ??
    firstExternalMessage?.fromAddress ??
    firstExternalParticipant ??
    "there"
  );
}

function mailboxSignatureName(thread: ThreadDetail) {
  return thread.mailbox.displayName.split(" ")[0] ?? thread.mailbox.displayName;
}

function initialsFromLabel(value: string | null | undefined) {
  const source = (value ?? "").trim();
  if (!source) {
    return "SM";
  }

  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function draftTemplatesForThread(thread: ThreadDetail | null): DraftTemplate[] {
  if (!thread) {
    return [];
  }

  const name = participantName(thread);
  const signoff = mailboxSignatureName(thread);
  const dueText = thread.replyState?.replyDueAt ? formatShortDate(thread.replyState.replyDueAt) : "today";
  const subject = thread.subject === "(no subject)" ? "your note" : thread.subject;

  return [
    {
      id: "acknowledge",
      label: "Acknowledge",
      body: `Hi ${name},\n\nThanks for the note about ${subject}. I have this in front of me and will follow up by ${dueText}.\n\nBest,\n${signoff}`
    },
    {
      id: "follow-up",
      label: "Follow up",
      body: `Hi ${name},\n\nChecking back on the thread below. Let me know if you have any updates or if you want me to move this forward from my side.\n\nBest,\n${signoff}`
    },
    {
      id: "clarify",
      label: "Clarify",
      body: `Hi ${name},\n\nI can take this next step, but I want to confirm one thing first so I do not move in the wrong direction. Can you send over the key detail you want me to work from?\n\nBest,\n${signoff}`
    }
  ];
}

function threadMatchesQuery(thread: ThreadSummary, normalizedQuery: string) {
  const haystack = [
    thread.subject,
    thread.latestMessage?.bodyPreview ?? "",
    thread.primaryOrganization?.name ?? "",
    thread.primaryOrganization?.primaryDomain ?? "",
    thread.latestMessage?.fromName ?? "",
    thread.latestMessage?.fromAddress ?? "",
    ...thread.participants.map((participant) => `${participant.name} ${participant.address}`)
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function matchesMailboxScope(
  scope: MailboxScope,
  role: "PERSONAL" | "SHARED" | "TEAM" | null | undefined,
  kind?: "PRIMARY" | "SHARED" | null
) {
  if (scope === "all") {
    return true;
  }

  const isShared = role === "SHARED" || role === "TEAM" || kind === "SHARED";
  return scope === "shared" ? isShared : !isShared;
}

function appleMailFoldersForStructuredSync(folders: ThunderbirdFolder[]) {
  return folders.filter((folder) => folder.type === "inbox" || folder.type === "sent" || (folder.type === "custom" && folder.name.includes("@")));
}

function summarizeAppleMailBackfill(result: AppleMailBackfillResult) {
  const indexedMessages = result.syncs.reduce(
    (total, sync) => total + sync.folders.reduce((folderTotal, folder) => folderTotal + folder.importedMessages, 0),
    0
  );
  const totalMessages = result.syncs.reduce(
    (total, sync) => total + sync.folders.reduce((folderTotal, folder) => folderTotal + folder.totalMessages, 0),
    0
  );

  return {
    indexedMessages,
    totalMessages
  };
}

function normalizeCommandText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isEditableElement(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) {
    return false;
  }

  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element.isContentEditable ||
    Boolean(element.closest("[contenteditable='true']"))
  );
}

export function MailApp() {
  const router = useRouter();
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("inbox");
  const [inboxQueue, setInboxQueue] = useState<InboxQueue>("allThreads");
  const [mailboxScope, setMailboxScope] = useState<MailboxScope>("all");
  const [search, setSearch] = useState("");
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [selectedAnalyticsMonths, setSelectedAnalyticsMonths] = useState<1 | 4 | 6>(4);
  const [draftText, setDraftText] = useState("");
  const [assistantData, setAssistantData] = useState<ThreadAssistantResponse | null>(null);
  const [isAssistantPending, startAssistantTransition] = useTransition();
  const [isActionPending, startActionTransition] = useTransition();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");

  const [thunderbirdStatus, setThunderbirdStatus] = useState<ThunderbirdStatus | null>(null);
  const [thunderbirdAccounts, setThunderbirdAccounts] = useState<ThunderbirdAccount[]>([]);
  const [selectedThunderbirdAccountId, setSelectedThunderbirdAccountId] = useState<string | null>(null);
  const [thunderbirdFolders, setThunderbirdFolders] = useState<ThunderbirdFolder[]>([]);
  const [selectedThunderbirdFolderPath, setSelectedThunderbirdFolderPath] = useState<string | null>(null);
  const [thunderbirdMessages, setThunderbirdMessages] = useState<ThunderbirdMessageSummary[]>([]);
  const [selectedThunderbirdMessageId, setSelectedThunderbirdMessageId] = useState<string | null>(null);
  const [selectedThunderbirdMessage, setSelectedThunderbirdMessage] = useState<ThunderbirdMessageDetail | null>(null);
  const [thunderbirdDiscoveredMailboxes, setThunderbirdDiscoveredMailboxes] = useState<ThunderbirdDiscoveredMailbox[]>([]);
  const [thunderbirdSyncSources, setThunderbirdSyncSources] = useState<ThunderbirdSyncSource[]>([]);
  const [selectedThunderbirdCandidateEmail, setSelectedThunderbirdCandidateEmail] = useState("");

  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [imports, setImports] = useState<ImportJobSummary[]>([]);
  const [workbench, setWorkbench] = useState<WorkbenchData | null>(null);
  const [organizationActivity, setOrganizationActivity] = useState<OrganizationActivityReport | null>(null);
  const [selectedActivityOrganizationId, setSelectedActivityOrganizationId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<ThreadDetail | null>(null);

  const [sharedMailboxEmail, setSharedMailboxEmail] = useState("");
  const [sharedMailboxName, setSharedMailboxName] = useState("");
  const [importMailboxEmail, setImportMailboxEmail] = useState("");
  const [importMailboxName, setImportMailboxName] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [thunderbirdImportMailboxEmail, setThunderbirdImportMailboxEmail] = useState("");
  const [thunderbirdImportMailboxName, setThunderbirdImportMailboxName] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSyncPending, startSyncTransition] = useTransition();
  const [isMailboxPending, startMailboxTransition] = useTransition();
  const [isImportPending, startImportTransition] = useTransition();
  const [isThunderbirdImportPending, startThunderbirdImportTransition] = useTransition();
  const [isThunderbirdBulkImportPending, startThunderbirdBulkImportTransition] = useTransition();
  const [hasAttemptedInitialAppleSync, setHasAttemptedInitialAppleSync] = useState(false);
  const [hasAttemptedAppleWorkspaceRecovery, setHasAttemptedAppleWorkspaceRecovery] = useState(false);
  const [hasLoadedThreadsOnce, setHasLoadedThreadsOnce] = useState(false);
  const [appleMailBackfill, setAppleMailBackfill] = useState<{
    status: "idle" | "running" | "complete" | "error";
    indexedMessages: number;
    totalMessages: number;
    importedThisSession: number;
    hasMore: boolean;
    error: string | null;
  }>({
    status: "idle",
    indexedMessages: 0,
    totalMessages: 0,
    importedThisSession: 0,
    hasMore: false,
    error: null
  });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const draftPadRef = useRef<HTMLTextAreaElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const appleMailBackfillRunIdRef = useRef(0);
  const appleMailBackfillActiveRef = useRef(false);

  const deferredSearch = useDeferredValue(search);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );
  const selectedMailbox = useMemo(
    () => selectedAccount?.mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? null,
    [selectedAccount, selectedMailboxId]
  );
  const selectedThunderbirdAccount = useMemo(
    () => thunderbirdAccounts.find((account) => account.id === selectedThunderbirdAccountId) ?? null,
    [thunderbirdAccounts, selectedThunderbirdAccountId]
  );
  const persistedAppleMailAccount = useMemo(
    () => accounts.find((account) => account.provider === "APPLE_MAIL") ?? null,
    [accounts]
  );
  const appleMailMailboxIds = useMemo(
    () =>
      new Set(
        accounts
          .filter((account) => account.provider === "APPLE_MAIL")
          .flatMap((account) => account.mailboxes.map((mailbox) => mailbox.id))
      ),
    [accounts]
  );
  const appleMailThreadStats = useMemo(() => {
    let count = 0;
    let newestThreadTime = Number.NEGATIVE_INFINITY;

    for (const thread of threads) {
      if (!appleMailMailboxIds.has(thread.mailboxId)) {
        continue;
      }

      count += 1;
      newestThreadTime = Math.max(newestThreadTime, new Date(thread.lastMessageAt).getTime());
    }

    return {
      count,
      newestThreadTime
    };
  }, [appleMailMailboxIds, threads]);
  const appleMailTargetMessageCount = useMemo(
    () => appleMailFoldersForStructuredSync(thunderbirdFolders).reduce((total, folder) => total + folder.totalMessages, 0),
    [thunderbirdFolders]
  );
  const appleMailIndexedMessages = useMemo(
    () =>
      persistedAppleMailAccount?.mailboxes.reduce((total, mailbox) => total + mailbox._count.messages, 0) ?? 0,
    [persistedAppleMailAccount]
  );
  const appleMailProgressTotal = Math.max(appleMailBackfill.totalMessages, appleMailTargetMessageCount);
  const appleMailProgressIndexed = Math.max(appleMailBackfill.indexedMessages, appleMailIndexedMessages);
  const appleMailProgressLabel =
    appleMailProgressTotal > 0
      ? appleMailBackfill.status === "running"
        ? `Indexing ${appleMailProgressIndexed}/${appleMailProgressTotal}`
        : appleMailProgressIndexed < appleMailProgressTotal
          ? `Indexed ${appleMailProgressIndexed}/${appleMailProgressTotal}`
          : `Indexed ${appleMailProgressIndexed}`
      : null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");

    if (connected === "1") {
      toast.success("Microsoft account connected. Initial sync has been queued.");
      params.delete("connected");
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`.replace(/\?$/, ""));
    }

    if (error) {
      toast.error(error);
      params.delete("error");
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`.replace(/\?$/, ""));
    }
  }, []);

  useEffect(() => {
    void refreshThunderbirdStatus();
    void refreshThunderbirdDiscovery();
    void refreshArchiveAccounts();
  }, []);

  useEffect(() => {
    if (loading || hasAttemptedInitialAppleSync) {
      return;
    }

    if (accounts.length > 0) {
      setHasAttemptedInitialAppleSync(true);
      return;
    }

    if (!thunderbirdStatus?.available || thunderbirdAccounts.length === 0) {
      return;
    }

    setHasAttemptedInitialAppleSync(true);
    startSyncTransition(async () => {
      try {
        const result = await syncLiveAppleMailIntoWorkspace(25, null, 365);
        const importedMessages = result.syncs.reduce((total, sync) => total + sync.importedMessages, 0);
        toast.success(
          importedMessages > 0
            ? `Loaded ${importedMessages} recent Apple Mail message${importedMessages === 1 ? "" : "s"} into the workspace.`
            : "Apple Mail is connected, but there were no recent messages to load."
        );
        await refreshArchiveAccounts();
        await refreshWorkbench();
        await refreshThreads();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load Apple Mail into the workspace.");
      }
    });
  }, [accounts.length, hasAttemptedInitialAppleSync, loading, startSyncTransition, thunderbirdAccounts.length, thunderbirdStatus]);

  useEffect(() => {
    if (appleMailBackfill.status === "running") {
      return;
    }

    if (appleMailProgressTotal > 0 && appleMailProgressIndexed >= appleMailProgressTotal) {
      setAppleMailBackfill((current) => ({
        ...current,
        status: "complete",
        indexedMessages: appleMailProgressIndexed,
        totalMessages: appleMailProgressTotal,
        hasMore: false,
        error: null
      }));
      return;
    }

    setAppleMailBackfill((current) => ({
      ...current,
      indexedMessages: Math.max(current.indexedMessages, appleMailProgressIndexed),
      totalMessages: Math.max(current.totalMessages, appleMailProgressTotal)
    }));
  }, [appleMailBackfill.status, appleMailProgressIndexed, appleMailProgressTotal]);

  useEffect(() => {
    if (loading || !hasLoadedThreadsOnce || hasAttemptedAppleWorkspaceRecovery) {
      return;
    }

    if (!thunderbirdStatus?.available || thunderbirdAccounts.length === 0 || accounts.length === 0) {
      return;
    }

    const newestThreadAgeMs = Date.now() - appleMailThreadStats.newestThreadTime;
    const isWorkspaceMissingAppleMail = appleMailMailboxIds.size === 0 || appleMailThreadStats.count === 0;
    const isWorkspaceStale =
      Number.isFinite(appleMailThreadStats.newestThreadTime) &&
      newestThreadAgeMs > 14 * 24 * 60 * 60 * 1000;

    if (!isWorkspaceMissingAppleMail && !isWorkspaceStale) {
      return;
    }

    setHasAttemptedAppleWorkspaceRecovery(true);
    startSyncTransition(async () => {
      try {
        const result = await syncLiveAppleMailIntoWorkspace(25, null, 365);
        const importedMessages = result.syncs.reduce((total, sync) => total + sync.importedMessages, 0);
        toast.success(
          importedMessages > 0
            ? `Refreshed ${importedMessages} recent Apple Mail message${importedMessages === 1 ? "" : "s"} into the workspace.`
            : "Apple Mail recovery ran, but there were no newer messages to ingest."
        );
        await refreshArchiveAccounts();
        await refreshWorkbench();
        await refreshThreads();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to refresh the Apple Mail workspace.");
      }
    });
  }, [
    accounts.length,
    appleMailMailboxIds.size,
    appleMailThreadStats.count,
    appleMailThreadStats.newestThreadTime,
    hasAttemptedAppleWorkspaceRecovery,
    hasLoadedThreadsOnce,
    loading,
    startSyncTransition,
    thunderbirdAccounts.length,
    thunderbirdStatus
  ]);

  useEffect(() => {
    if (loading || !persistedAppleMailAccount || !thunderbirdStatus?.available) {
      return;
    }

    if (appleMailBackfillActiveRef.current) {
      return;
    }

    if (appleMailProgressTotal === 0 || appleMailProgressIndexed >= appleMailProgressTotal) {
      return;
    }

    void runAppleMailBackfill(persistedAppleMailAccount.id, false);
  }, [
    appleMailProgressIndexed,
    appleMailProgressTotal,
    loading,
    persistedAppleMailAccount,
    thunderbirdStatus
  ]);

  useEffect(() => {
    if (!selectedThunderbirdAccountId) {
      return;
    }

    void refreshThunderbirdFolders(selectedThunderbirdAccountId);
  }, [selectedThunderbirdAccountId]);

  useEffect(() => {
    if (workspaceView !== "live") {
      return;
    }

    void refreshThunderbirdMessages(selectedThunderbirdFolderPath ?? undefined, deferredSearch);
  }, [workspaceView, selectedThunderbirdFolderPath, deferredSearch]);

  useEffect(() => {
    if (!selectedThunderbirdMessageId || !selectedThunderbirdFolderPath || workspaceView !== "live") {
      setSelectedThunderbirdMessage(null);
      return;
    }

    void loadThunderbirdMessage(selectedThunderbirdMessageId, selectedThunderbirdFolderPath);
  }, [selectedThunderbirdFolderPath, selectedThunderbirdMessageId, workspaceView]);

  useEffect(() => {
    if (!selectedMailboxId) {
      void refreshThreads();
      setSelectedThread(null);
      void refreshWorkbench();
      void refreshImports(undefined, selectedAccountId ?? undefined);
      return;
    }

    void refreshThreads(selectedMailboxId);
    void refreshWorkbench(selectedMailboxId);
    void refreshImports(selectedMailboxId, selectedAccountId ?? undefined);
  }, [selectedMailboxId, selectedAccountId]);

  useEffect(() => {
    if (workspaceView !== "analytics") {
      return;
    }

    void refreshOrganizationActivity(selectedAnalyticsMonths);
  }, [workspaceView, selectedAnalyticsMonths]);

  useEffect(() => {
    if (!selectedThreadId) {
      setSelectedThread(null);
      setAssistantData(null);
      return;
    }

    void loadThread(selectedThreadId);
  }, [selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || workspaceView === "analytics" || workspaceView === "live") {
      setAssistantData(null);
      return;
    }

    startAssistantTransition(async () => {
      try {
        const data = await fetchThreadAssistant(selectedThreadId);
        setAssistantData(data);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load assistant briefing.");
      }
    });
  }, [selectedThreadId, workspaceView]);

  useEffect(() => {
    const templates = draftTemplatesForThread(selectedThread);
    setDraftText(templates[0]?.body ?? "");
  }, [selectedThreadId, selectedThread]);

  useEffect(() => {
    if (!isCommandPaletteOpen) {
      return;
    }

    commandInputRef.current?.focus();
  }, [isCommandPaletteOpen]);

  async function refreshThunderbirdStatus() {
    try {
      const status = await fetchThunderbirdStatus();
      setThunderbirdStatus(status);

      if (status.available) {
        const data = await fetchThunderbirdAccounts();
        setThunderbirdAccounts(data.accounts);
        await refreshThunderbirdDiscovery();

        startTransition(() => {
          const nextAccount = data.accounts[0] ?? null;
          setSelectedThunderbirdAccountId(nextAccount?.id ?? null);
        });
      } else {
        setThunderbirdAccounts([]);
        setThunderbirdFolders([]);
        setThunderbirdMessages([]);
        setSelectedThunderbirdAccountId(null);
        setSelectedThunderbirdFolderPath(null);
        setSelectedThunderbirdMessageId(null);
      }
    } catch (error) {
      setThunderbirdStatus({
        available: false,
        authenticated: false,
        authServerReachable: false,
        bridgeUrl: "Mail.app Automation",
        accountCount: 0,
        error: error instanceof Error ? error.message : "Apple Mail status check failed."
      });
    }
  }

  async function refreshThunderbirdDiscovery() {
    setThunderbirdDiscoveredMailboxes([]);
    setThunderbirdSyncSources([]);
    setSelectedThunderbirdCandidateEmail("");
  }

  async function refreshThunderbirdFolders(accountId: string) {
    try {
      const data = await fetchThunderbirdFolders(accountId);
      setThunderbirdFolders(data.folders);
      setSelectedThunderbirdFolderPath((current) => {
        const retained = data.folders.find((folder) => folder.path === current)?.path;
        return retained ?? data.folders.find((folder) => folder.type === "inbox")?.path ?? data.folders[0]?.path ?? null;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load Apple Mail folders.");
    }
  }

  async function refreshThunderbirdMessages(folderPath?: string, query?: string) {
    try {
      const data =
        query && query.trim().length > 0
          ? await searchThunderbirdMessages(query, folderPath, selectedThunderbirdAccountId ?? undefined)
          : await fetchThunderbirdRecentMessages(folderPath, selectedThunderbirdAccountId ?? undefined);

      setThunderbirdMessages(data.messages);
      setSelectedThunderbirdMessageId((current) => {
        const retained = data.messages.find((message) => message.id === current);
        return retained?.id ?? data.messages[0]?.id ?? null;
      });
      setSelectedThunderbirdMessage((current) => {
        const retained = data.messages.find((message) => message.id === current?.id);
        const nextMessage = retained ?? data.messages[0] ?? null;
        if (!nextMessage) {
          return null;
        }

        if (current?.id === nextMessage.id && current.body && current.body !== "Loading message body...") {
          return current;
        }

        const folderType = thunderbirdFolders.find((folder) => folder.path === nextMessage.folderPath)?.type ?? null;
        return seedLiveMessageDetail(nextMessage, selectedThunderbirdAccount?.name ?? null, folderType);
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load Apple Mail messages.");
    }
  }

  async function loadThunderbirdMessage(messageId: string, folderPath: string) {
    try {
      const data = await fetchThunderbirdMessage(messageId, folderPath);
      setSelectedThunderbirdMessage({
        ...data.message,
        attachments: data.message.attachments ?? []
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load Apple Mail message.");
    }
  }

  function selectLiveMessage(message: ThunderbirdMessageSummary) {
    const folderType = thunderbirdFolders.find((folder) => folder.path === message.folderPath)?.type ?? null;
    setSelectedThunderbirdMessage(seedLiveMessageDetail(message, selectedThunderbirdAccount?.name ?? null, folderType));
    setSelectedThunderbirdFolderPath(message.folderPath);
    setSelectedThunderbirdMessageId(message.id);
  }

  function focusSearch() {
    const input = searchInputRef.current;
    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }

  function focusComposer() {
    const composer = draftPadRef.current;
    if (!composer) {
      return;
    }

    composer.focus();
    const end = composer.value.length;
    composer.setSelectionRange(end, end);
  }

  async function refreshSelectedThreadSurfaces(threadId: string, mailboxId?: string | null) {
    await Promise.all([
      loadThread(threadId),
      refreshWorkbench(mailboxId ?? undefined),
      refreshThreads(mailboxId ?? undefined)
    ]);
  }

  async function ingestLiveAppleMailAccount(account: ThunderbirdAccount, maxMessagesPerFolder = 25, recentDays = 365) {
    const foldersData = await fetchThunderbirdFolders(account.id);
    const targetFolders = appleMailFoldersForStructuredSync(foldersData.folders);
    const messagesByFolder: Array<{ folderPath: string; messages: ThunderbirdMessageSummary[] }> = [];

    for (const folder of targetFolders) {
      const data = await fetchThunderbirdRecentMessages(folder.path, account.id, recentDays);
      messagesByFolder.push({
        folderPath: folder.path,
        messages: data.messages.slice(0, maxMessagesPerFolder)
      });
    }

    return ingestAppleMailAccount({
      account,
      folders: foldersData.folders,
      messagesByFolder
    });
  }

  async function syncLiveAppleMailIntoWorkspace(
    maxMessagesPerFolder = 25,
    preferredAccountEmail?: string | null,
    recentDays = 365
  ) {
    const normalizedPreferredEmail = preferredAccountEmail?.trim().toLowerCase() ?? "";
    const candidateAccounts = normalizedPreferredEmail
      ? thunderbirdAccounts.filter((account) =>
          account.identities.some((identity) => identity.email.trim().toLowerCase() === normalizedPreferredEmail)
        )
      : thunderbirdAccounts;
    const liveAccounts = candidateAccounts.length > 0 ? candidateAccounts : thunderbirdAccounts;
    const syncs = [];

    for (const account of liveAccounts) {
      const result = await ingestLiveAppleMailAccount(account, maxMessagesPerFolder, recentDays);
      syncs.push(...result.syncs);
    }

    return {
      syncs
    };
  }

  async function runAppleMailBackfill(accountId: string, announceCompletion: boolean) {
    if (appleMailBackfillActiveRef.current) {
      return;
    }

    appleMailBackfillActiveRef.current = true;
    const runId = appleMailBackfillRunIdRef.current + 1;
    appleMailBackfillRunIdRef.current = runId;
    let importedThisSession = 0;

    setAppleMailBackfill((current) => ({
      ...current,
      status: "running",
      error: null
    }));

    try {
      for (let iteration = 0; iteration < 200; iteration += 1) {
        const result = await backfillAppleMailAccount({
          accountId,
          batchSize: 50
        });

        if (appleMailBackfillRunIdRef.current !== runId) {
          return;
        }

        importedThisSession += result.totalImportedMessages;
        const summary = summarizeAppleMailBackfill(result);

        setAppleMailBackfill({
          status: result.hasMore ? "running" : "complete",
          indexedMessages: summary.indexedMessages,
          totalMessages: summary.totalMessages,
          importedThisSession,
          hasMore: result.hasMore,
          error: null
        });

        if (iteration === 0 || iteration % 3 === 2 || !result.hasMore) {
          await refreshArchiveAccounts();
          await refreshWorkbench(selectedMailboxId ?? undefined);
          await refreshThreads(selectedMailboxId ?? undefined);
        }

        if (!result.hasMore) {
          if (announceCompletion && importedThisSession > 0) {
            toast.success(
              `Indexed ${summary.indexedMessages} Apple Mail message${summary.indexedMessages === 1 ? "" : "s"} into the workspace.`
            );
          }
          break;
        }

        if (result.totalImportedMessages === 0) {
          throw new Error("Apple Mail indexing stalled before the mailbox finished backfilling.");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to backfill Apple Mail.";
      setAppleMailBackfill((current) => ({
        ...current,
        status: "error",
        error: message
      }));
      toast.error(message);
    } finally {
      if (appleMailBackfillRunIdRef.current === runId) {
        appleMailBackfillActiveRef.current = false;
      }
    }
  }

  function applySuggestedDraft(variantId?: string) {
    if (!assistantData?.draftSuggestions.length) {
      return;
    }

    const variant =
      assistantData.draftSuggestions.find((draftSuggestion) => draftSuggestion.id === variantId) ??
      assistantData.draftSuggestions[0];
    if (!variant) {
      return;
    }

    setDraftText(variant.body);
    focusComposer();
    toast.success(`Loaded ${variant.label.toLowerCase()} draft.`);
  }

  function queueFollowUp(hoursFromNow: number, label: string) {
    if (!selectedThreadId) {
      return;
    }

    const dueAt = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();

    startActionTransition(async () => {
      try {
        await createThreadFollowUp(selectedThreadId, {
          dueAt,
          note: `${label} from the mail workspace`
        });
        toast.success(`${label} scheduled.`);
        await refreshSelectedThreadSurfaces(selectedThreadId, selectedMailboxId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to schedule follow-up.");
      }
    });
  }

  function updateThreadReadState(read: boolean) {
    if (!selectedThreadId) {
      return;
    }

    startActionTransition(async () => {
      try {
        await setThreadReadState(selectedThreadId, read);
        toast.success(read ? "Thread marked read." : "Thread marked unread.");
        await refreshSelectedThreadSurfaces(selectedThreadId, selectedMailboxId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update read state.");
      }
    });
  }

  function updateThreadArchivedState(archived: boolean) {
    if (!selectedThreadId) {
      return;
    }

    startActionTransition(async () => {
      try {
        await setThreadArchivedState(selectedThreadId, archived);
        toast.success(archived ? "Thread archived." : "Thread restored to the queue.");
        await refreshWorkbench(selectedMailboxId ?? undefined);
        await refreshThreads(selectedMailboxId ?? undefined);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update archive state.");
      }
    });
  }

  async function refreshArchiveAccounts() {
    setLoading(true);

    try {
      const data = await fetchAccounts();
      setAccounts(data.accounts);

      startTransition(() => {
        const currentAccountId = selectedAccountId ?? data.accounts[0]?.id ?? null;
        const nextAccount =
          data.accounts.find((account) => account.id === currentAccountId) ?? data.accounts[0] ?? null;
        const nextMailboxId = nextAccount?.mailboxes.find((mailbox) => mailbox.id === selectedMailboxId)?.id ?? null;

        setSelectedAccountId(nextAccount?.id ?? null);
        setSelectedMailboxId(nextMailboxId);
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load imported accounts.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshThreads(mailboxId?: string) {
    try {
      const data = await fetchThreads(mailboxId);
      setThreads(data.threads);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load threads.");
    } finally {
      setHasLoadedThreadsOnce(true);
    }
  }

  async function refreshWorkbench(mailboxId?: string) {
    try {
      const data = await fetchWorkbench(mailboxId);
      setWorkbench(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load workbench.");
    }
  }

  async function refreshOrganizationActivity(months: number, mailboxId?: string) {
    try {
      const data = await fetchOrganizationActivity(months, 25, mailboxId);
      setOrganizationActivity(data);
      setSelectedActivityOrganizationId((current) => {
        const retained = data.organizations.find((organization) => organization.organizationId === current)?.organizationId;
        return retained ?? data.organizations[0]?.organizationId ?? null;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load organization activity.");
    }
  }

  async function loadThread(threadId: string) {
    try {
      const data = await fetchThread(threadId);
      setSelectedThread(data.thread);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load thread detail.");
    }
  }

  async function refreshImports(mailboxId?: string, accountId?: string) {
    try {
      const data = await fetchImports(mailboxId, accountId);
      setImports(data.imports);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load archive imports.");
    }
  }

  async function handleManualSync() {
    if (!selectedAccount) {
      toast.error("Choose an imported account before syncing.");
      return;
    }

    if (selectedAccount.provider === "ARCHIVE") {
      toast.error("Archive-only accounts do not support live sync.");
      return;
    }

    startSyncTransition(async () => {
      try {
        if (selectedAccount.provider === "APPLE_MAIL") {
          const result = await syncLiveAppleMailIntoWorkspace(25, selectedAccount.email, 365);
          const importedMessages = result.syncs.reduce((total, sync) => total + sync.importedMessages, 0);
          toast.success(
            importedMessages > 0
              ? `Synced ${importedMessages} Apple Mail message${importedMessages === 1 ? "" : "s"} into the workspace.`
              : "Apple Mail sync completed."
          );
          await refreshArchiveAccounts();
          await runAppleMailBackfill(selectedAccount.id, true);
        } else {
          const result = await queueSync(selectedAccount.id);
          toast.success(`Queued ${result.queued} mailbox sync${result.queued === 1 ? "" : "s"}.`);
        }
        await refreshWorkbench(selectedMailboxId ?? undefined);
        await refreshThreads(selectedMailboxId ?? undefined);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to queue sync.");
      }
    });
  }

  async function handleAddSharedMailbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedAccount || selectedAccount.provider !== "MICROSOFT") {
      toast.error("Choose a Microsoft-backed imported account first.");
      return;
    }

    startMailboxTransition(async () => {
      try {
        await addSharedMailbox(selectedAccount.id, {
          emailAddress: sharedMailboxEmail,
          displayName: sharedMailboxName || undefined
        });
        toast.success("Shared mailbox added and queued for sync.");
        setSharedMailboxEmail("");
        setSharedMailboxName("");
        await refreshArchiveAccounts();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to add shared mailbox.");
      }
    });
  }

  async function handleArchiveImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!importFile) {
      toast.error("Choose a .eml or .olm file first.");
      return;
    }

    startImportTransition(async () => {
      try {
        const result = await uploadArchive({
          file: importFile,
          accountId: selectedAccountId ?? undefined,
          mailboxId: selectedMailboxId ?? undefined,
          mailboxEmail: selectedMailboxId ? undefined : importMailboxEmail || undefined,
          mailboxDisplayName: selectedMailboxId ? undefined : importMailboxName || undefined
        });

        toast.success(
          `Imported ${result.importJob.importedMessages} message${result.importJob.importedMessages === 1 ? "" : "s"} from ${result.importJob.format}.`
        );
        setImportFile(null);
        setImportMailboxEmail("");
        setImportMailboxName("");
        await refreshArchiveAccounts();
        await refreshWorkbench(selectedMailboxId ?? undefined);
        await refreshImports(selectedMailboxId ?? undefined, selectedAccountId ?? undefined);
        if (selectedMailboxId) {
          await refreshThreads(selectedMailboxId);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Archive import failed.");
      }
    });
  }

  async function handleThunderbirdImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedThunderbirdAccountId) {
      toast.error("Choose a Thunderbird account first.");
      return;
    }

    startThunderbirdImportTransition(async () => {
      try {
        const selectedCandidate =
          thunderbirdDiscoveredMailboxes.find((candidate) => candidate.mailboxEmail === selectedThunderbirdCandidateEmail) ??
          null;
        const result = await syncThunderbirdMailbox({
          thunderbirdAccountId: selectedCandidate?.thunderbirdAccountId ?? selectedThunderbirdAccountId,
          mailboxEmail: thunderbirdImportMailboxEmail || selectedCandidate?.mailboxEmail || undefined,
          mailboxDisplayName: thunderbirdImportMailboxName || selectedCandidate?.mailboxDisplayName || undefined,
          daysBack: 45,
          maxMessagesPerFolder: 250
        });

        toast.success(
          `Synced ${result.sync.importedMessages} Thunderbird message${result.sync.importedMessages === 1 ? "" : "s"} into ${result.sync.mailbox.emailAddress}.`
        );
        setThunderbirdImportMailboxEmail("");
        setThunderbirdImportMailboxName("");
        await refreshThunderbirdDiscovery();
        await refreshArchiveAccounts();
        await refreshWorkbench(result.sync.mailbox.id);
        await refreshThreads(result.sync.mailbox.id);
        setSelectedAccountId(result.sync.account.id);
        setSelectedMailboxId(result.sync.mailbox.id);
        setWorkspaceView("inbox");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Thunderbird sync failed.");
      }
    });
  }

  async function handleThunderbirdBulkImport() {
    startThunderbirdBulkImportTransition(async () => {
      try {
        const result = await syncAllThunderbirdMailboxes({
          daysBack: 45,
          maxMessagesPerFolder: 250
        });
        toast.success(`Synced ${result.syncs.length} discovered Thunderbird mailbox${result.syncs.length === 1 ? "" : "es"} into the client.`);
        await refreshThunderbirdDiscovery();
        await refreshArchiveAccounts();
        await refreshWorkbench();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Thunderbird bulk sync failed.");
      }
    });
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draftText);
      toast.success("Draft copied to clipboard.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to copy draft.");
    }
  }

  const normalizedQuery = deferredSearch.trim().toLowerCase();

  const allArchiveThreads = useMemo(() => {
    const scopedThreads = threads.filter((thread) => matchesMailboxScope(mailboxScope, thread.mailbox.role, thread.mailbox.kind));
    if (!normalizedQuery) {
      return scopedThreads;
    }

    return scopedThreads.filter((thread) => threadMatchesQuery(thread, normalizedQuery));
  }, [mailboxScope, normalizedQuery, threads]);

  const filteredNeedsReply = useMemo(() => {
    const items = (workbench?.needsReply ?? []).filter((thread) =>
      matchesMailboxScope(mailboxScope, thread.mailbox.role, thread.mailbox.kind)
    );
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((thread) => threadMatchesQuery(thread, normalizedQuery));
  }, [mailboxScope, normalizedQuery, workbench]);

  const filteredWaiting = useMemo(() => {
    const items = (workbench?.waitingOnThem ?? []).filter((thread) =>
      matchesMailboxScope(mailboxScope, thread.mailbox.role, thread.mailbox.kind)
    );
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((thread) => threadMatchesQuery(thread, normalizedQuery));
  }, [mailboxScope, normalizedQuery, workbench]);

  const filteredFollowUps = useMemo(() => {
    const items = (workbench?.followUpToday ?? []).filter((task) => matchesMailboxScope(mailboxScope, task.mailbox.role));
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((task) =>
      [task.title, task.note ?? "", task.organization?.name ?? "", task.thread.subject, task.contact?.displayName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [mailboxScope, normalizedQuery, workbench]);

  const filteredOrganizations = useMemo(() => {
    const items = workbench?.byOrganization ?? [];
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((organization) =>
      [organization.name, organization.primaryDomain ?? "", organization.kind].join(" ").toLowerCase().includes(normalizedQuery)
    );
  }, [normalizedQuery, workbench]);

  const filteredActivityOrganizations = useMemo(() => {
    const items = organizationActivity?.organizations ?? [];
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((organization) =>
      [
        organization.name,
        organization.primaryDomain ?? "",
        organization.kind,
        organization.inferredKind,
        organization.dominantCategory ?? ""
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [normalizedQuery, organizationActivity]);

  const inboxThreads =
    inboxQueue === "needsReply" ? filteredNeedsReply : inboxQueue === "waitingOnThem" ? filteredWaiting : allArchiveThreads;

  const selectedOrganization = useMemo(
    () => filteredOrganizations.find((organization) => organization.id === selectedOrganizationId) ?? filteredOrganizations[0] ?? null,
    [filteredOrganizations, selectedOrganizationId]
  );

  const selectedActivityOrganization = useMemo(
    () =>
      filteredActivityOrganizations.find((organization) => organization.organizationId === selectedActivityOrganizationId) ??
      filteredActivityOrganizations[0] ??
      null,
    [filteredActivityOrganizations, selectedActivityOrganizationId]
  );

  const organizationThreads = useMemo(() => {
    if (!selectedOrganization) {
      return [];
    }

    return allArchiveThreads.filter((thread) => thread.primaryOrganization?.id === selectedOrganization.id);
  }, [allArchiveThreads, selectedOrganization]);

  const activeLeftPaneRows = useMemo(() => {
    switch (workspaceView) {
      case "accounts":
        return filteredOrganizations.map((organization) => organization.id);
      case "analytics":
        return filteredActivityOrganizations.map((organization) => organization.organizationId);
      case "followups":
        return filteredFollowUps.map((task) => task.thread.id);
      case "live":
        return thunderbirdMessages.map((message) => message.id);
      case "inbox":
      default:
        return inboxThreads.map((thread) => thread.id);
    }
  }, [
    filteredActivityOrganizations,
    filteredFollowUps,
    filteredOrganizations,
    inboxThreads,
    thunderbirdMessages,
    workspaceView
  ]);

  const activeLeftPaneSelection =
    workspaceView === "accounts"
      ? selectedOrganization?.id ?? null
      : workspaceView === "analytics"
        ? selectedActivityOrganization?.organizationId ?? null
        : workspaceView === "live"
          ? selectedThunderbirdMessageId
          : selectedThreadId;

  function moveLeftPaneSelection(delta: number) {
    if (!activeLeftPaneRows.length) {
      return;
    }

    const currentIndex = activeLeftPaneSelection ? activeLeftPaneRows.indexOf(activeLeftPaneSelection) : -1;
    const fallbackIndex = delta > 0 ? 0 : activeLeftPaneRows.length - 1;
    const nextIndex =
      currentIndex === -1 ? fallbackIndex : Math.min(Math.max(currentIndex + delta, 0), activeLeftPaneRows.length - 1);
    const nextId = activeLeftPaneRows[nextIndex];

    if (!nextId) {
      return;
    }

    if (workspaceView === "accounts") {
      setSelectedOrganizationId(nextId);
      return;
    }

    if (workspaceView === "analytics") {
      setSelectedActivityOrganizationId(nextId);
      return;
    }

    if (workspaceView === "live") {
      const nextMessage = thunderbirdMessages.find((message) => message.id === nextId);
      if (nextMessage) {
        selectLiveMessage(nextMessage);
      }
      return;
    }

    setSelectedThreadId(nextId);
  }

  const canFocusComposer = workspaceView === "live" ? Boolean(selectedThunderbirdMessage) : workspaceView !== "analytics" && Boolean(selectedThread);

  useEffect(() => {
    if (workspaceView === "live") {
      return;
    }

    if (workspaceView === "accounts") {
      setSelectedOrganizationId((current) => filteredOrganizations.find((organization) => organization.id === current)?.id ?? filteredOrganizations[0]?.id ?? null);
      setSelectedThreadId((current) => organizationThreads.find((thread) => thread.id === current)?.id ?? organizationThreads[0]?.id ?? null);
      return;
    }

    if (workspaceView === "followups") {
      setSelectedThreadId((current) => filteredFollowUps.find((task) => task.thread.id === current)?.thread.id ?? filteredFollowUps[0]?.thread.id ?? null);
      return;
    }

    if (workspaceView === "analytics") {
      setSelectedActivityOrganizationId(
        (current) =>
          filteredActivityOrganizations.find((organization) => organization.organizationId === current)?.organizationId ??
          filteredActivityOrganizations[0]?.organizationId ??
          null
      );
      return;
    }

    setSelectedThreadId((current) => inboxThreads.find((thread) => thread.id === current)?.id ?? inboxThreads[0]?.id ?? null);
  }, [filteredActivityOrganizations, filteredFollowUps, filteredOrganizations, inboxThreads, organizationThreads, workspaceView]);

  useEffect(() => {
    if (workspaceView !== "inbox") {
      return;
    }

    if (!workbench) {
      return;
    }

    if (inboxQueue === "needsReply" && filteredNeedsReply.length === 0 && allArchiveThreads.length > 0) {
      setInboxQueue("allThreads");
    }
  }, [allArchiveThreads.length, filteredNeedsReply.length, inboxQueue, workspaceView, workbench]);

  useEffect(() => {
    if (!activeLeftPaneSelection) {
      return;
    }

    const row = document.querySelector<HTMLElement>(`[data-row-id="${activeLeftPaneSelection}"]`);
    row?.scrollIntoView({
      block: "nearest"
    });
  }, [activeLeftPaneSelection]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setIsCommandPaletteOpen((current) => !current);
        setCommandQuery("");
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (event.key === "Escape") {
        if (isCommandPaletteOpen) {
          setIsCommandPaletteOpen(false);
          setCommandQuery("");
          return;
        }

        if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
          document.activeElement.blur();
          return;
        }
      }

      if (isEditableElement(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveLeftPaneSelection(1);
        return;
      }

      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveLeftPaneSelection(-1);
        return;
      }

      if ((event.key === "Enter" || event.key.toLowerCase() === "r") && canFocusComposer) {
        event.preventDefault();
        focusComposer();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeLeftPaneRows, activeLeftPaneSelection, canFocusComposer, isCommandPaletteOpen, workspaceView, thunderbirdMessages]);

  const workspaceTitle =
    workspaceView === "inbox"
      ? inboxQueue === "needsReply"
        ? "Needs Reply"
        : inboxQueue === "waitingOnThem"
          ? "Waiting on Client"
          : "All Mail"
      : workspaceView === "accounts"
        ? "Accounts"
      : workspaceView === "followups"
        ? "Follow-ups"
      : workspaceView === "analytics"
        ? "Analytics"
        : "Apple Mail Live";

  const workspaceCopy =
    workspaceView === "inbox"
      ? "Triage the next important thread, then work the conversation in one place."
      : workspaceView === "accounts"
        ? "Group work by company so client pressure and stale accounts are visible."
      : workspaceView === "followups"
        ? "Run the reminder queue without digging through raw inbox history."
      : workspaceView === "analytics"
        ? "Rank client activity over time and answer who has been busiest in a given window."
      : "Browse Mail.app live on this Mac, then use imports and workbench intelligence alongside it.";

  const selectedImportSummary = imports[0] ?? null;
  const liveHeaderName =
    thunderbirdFolders.find((folder) => folder.path === selectedThunderbirdFolderPath)?.name ??
    selectedThunderbirdAccount?.name ??
    "Apple Mail";
  const draftTemplates = draftTemplatesForThread(selectedThread);
  const selectedPerson = primaryThreadPerson(selectedThread);
  const selectedThreadOrganization = primaryThreadOrganization(selectedThread);
  const selectedPersonEmail = selectedPerson?.emailAddress ?? selectedThread?.messages.at(-1)?.fromAddress ?? null;
  const selectedPersonInitials = initials(selectedPerson?.displayName ?? selectedPersonEmail ?? selectedThread?.subject ?? "Smart Mail");
  const selectedThreadDomain = selectedThreadOrganization?.primaryDomain ?? emailDomain(selectedPersonEmail);
  const selectedThreadKind = selectedThreadOrganization?.kind?.toLowerCase() ?? "contact";
  const liveSenderAddress = extractEmailAddress(selectedThunderbirdMessage?.author);
  const liveSenderDomain =
    emailDomain(liveSenderAddress) ||
    emailDomain(selectedThunderbirdMessage?.recipients) ||
    emailDomain(selectedThunderbirdMessage?.accountName);
  const liveSenderInitials = initials(selectedThunderbirdMessage?.author ?? selectedThunderbirdMessage?.subject ?? "Mail");
  const archiveReplySuggestions = ["You got it", "Looks good", "Following up"];
  const liveReplySuggestions = ["You too!", "Looking forward", "Sure thing"];
  const latestThreadMessage = selectedThread?.messages.at(-1) ?? null;
  const earlierThreadMessages = selectedThread?.messages.slice(0, -1) ?? [];
  const showInspectorPane =
    workspaceView === "accounts" ||
    workspaceView === "analytics" ||
    (workspaceView === "live" ? Boolean(selectedThunderbirdMessage) : Boolean(selectedThread));
  const topbarContextLabel =
    workspaceView === "inbox"
      ? inboxQueue === "needsReply"
        ? `${filteredNeedsReply.length} in queue`
        : inboxQueue === "waitingOnThem"
          ? `${filteredWaiting.length} waiting`
          : `${allArchiveThreads.length} threads`
      : workspaceView === "live"
        ? `${selectedThunderbirdAccount?.name ?? "Mail.app"} · ${liveHeaderName}`
        : null;

  const commandItems = useMemo(() => {
    const items = [
      {
        id: "workspace-inbox",
        label: "Open Inbox",
        hint: "Switch to inbox queue",
        run: () => setWorkspaceView("inbox")
      },
      {
        id: "workspace-followups",
        label: "Open Follow-ups",
        hint: "Jump to the reminder queue",
        run: () => setWorkspaceView("followups")
      },
      {
        id: "workspace-live",
        label: "Open Live Mail",
        hint: "Browse Apple Mail on this Mac",
        run: () => setWorkspaceView("live")
      },
      {
        id: "settings-models",
        label: "Open Settings: Models",
        hint: "Adjust model routing",
        run: () => router.push("/settings/models")
      },
      {
        id: "settings-accounts",
        label: "Open Settings: Accounts",
        hint: "Adjust mailbox routing",
        run: () => router.push("/settings/accounts")
      },
      {
        id: "settings-workflows",
        label: "Open Settings: Workflows",
        hint: "Adjust workflow defaults",
        run: () => router.push("/settings/workflows")
      },
      {
        id: "focus-search",
        label: "Focus Search",
        hint: "Move to the global search box",
        run: () => focusSearch()
      },
      {
        id: "focus-composer",
        label: "Focus Composer",
        hint: "Jump into the inline reply box",
        run: () => focusComposer()
      },
      {
        id: "queue-needs-reply",
        label: "Queue: Needs Reply",
        hint: "Show the urgent reply queue",
        run: () => {
          setWorkspaceView("inbox");
          setInboxQueue("needsReply");
        }
      },
      {
        id: "queue-waiting",
        label: "Queue: Waiting",
        hint: "Show waiting threads",
        run: () => {
          setWorkspaceView("inbox");
          setInboxQueue("waitingOnThem");
        }
      },
      {
        id: "scope-shared",
        label: "Filter: Shared Mailboxes",
        hint: "Focus on shared inbox work",
        run: () => setMailboxScope("shared")
      },
      {
        id: "scope-personal",
        label: "Filter: Personal Mailboxes",
        hint: "Focus on personal inbox work",
        run: () => setMailboxScope("personal")
      },
      {
        id: "scope-all",
        label: "Filter: All Mailboxes",
        hint: "Show all mailbox work",
        run: () => setMailboxScope("all")
      }
    ];

    if (selectedThreadId) {
      items.push(
        {
          id: "thread-read",
          label: "Mark Thread Read",
          hint: "Clear unread state for the selected thread",
          run: () => updateThreadReadState(true)
        },
        {
          id: "thread-unread",
          label: "Mark Thread Unread",
          hint: "Return the thread to unread",
          run: () => updateThreadReadState(false)
        },
        {
          id: "thread-archive",
          label: "Archive Thread",
          hint: "Clear it from the active queue",
          run: () => updateThreadArchivedState(true)
        },
        {
          id: "thread-remind-tomorrow",
          label: "Remind Tomorrow",
          hint: "Create a follow-up for tomorrow",
          run: () => queueFollowUp(24, "Follow up tomorrow")
        },
        {
          id: "thread-remind-friday",
          label: "Remind in 3 Days",
          hint: "Create a follow-up for later this week",
          run: () => queueFollowUp(72, "Follow up later this week")
        }
      );
    }

    if (assistantData?.draftSuggestions.length) {
      for (const draftSuggestion of assistantData.draftSuggestions) {
        items.push({
          id: `draft-${draftSuggestion.id}`,
          label: `Apply Draft: ${draftSuggestion.label}`,
          hint: draftSuggestion.subject,
          run: () => applySuggestedDraft(draftSuggestion.id)
        });
      }
    }

    const normalizedCommandQuery = normalizeCommandText(commandQuery);
    return normalizedCommandQuery
      ? items.filter((item) =>
          normalizeCommandText(`${item.label} ${item.hint} ${item.id}`).includes(normalizedCommandQuery)
        )
      : items;
  }, [assistantData, commandQuery, router, selectedThreadId]);

  return (
    <AppShell
      workspaceKey={workspaceView}
      secondaryLabel="Workspace"
      secondaryItems={[
        {
          label: "Inbox",
          icon: Inbox,
          active: workspaceView === "inbox",
          onSelect: () => setWorkspaceView("inbox"),
          badge: workbench?.summary.needsReply ?? 0,
          testId: "workspace-nav-inbox"
        },
        {
          label: "Accounts",
          icon: Building2,
          active: workspaceView === "accounts",
          onSelect: () => setWorkspaceView("accounts"),
          testId: "workspace-nav-accounts"
        },
        {
          label: "Follow-ups",
          icon: Clock3,
          active: workspaceView === "followups",
          onSelect: () => setWorkspaceView("followups"),
          badge: workbench?.summary.followUpToday ?? 0,
          testId: "workspace-nav-followups"
        },
        {
          label: "Analytics",
          icon: BrainCircuit,
          active: workspaceView === "analytics",
          onSelect: () => setWorkspaceView("analytics"),
          testId: "workspace-nav-analytics"
        },
        {
          label: "Live",
          icon: PlugZap,
          active: workspaceView === "live",
          onSelect: () => setWorkspaceView("live"),
          testId: "workspace-nav-live"
        }
      ]}
      stats={[
        {
          label: "Needs reply",
          value: workbench?.summary.needsReply ?? 0
        },
        {
          label: "Waiting",
          value: workbench?.summary.waitingOnThem ?? 0
        },
        {
          label: "Due today",
          value: workbench?.summary.followUpToday ?? 0
        }
      ]}
    >
          <header className={`client-topbar ${workspaceView === "inbox" || workspaceView === "live" ? "utility" : ""}`}>
            {workspaceView === "inbox" || workspaceView === "live" ? (
              <div className="topbar-copy utility-copy">
                <div className="utility-title-row">
                  <h2>{workspaceTitle}</h2>
                  {topbarContextLabel ? <span className="soft-tag">{topbarContextLabel}</span> : null}
                  {workspaceView === "inbox" && appleMailProgressLabel ? <span className="soft-tag">{appleMailProgressLabel}</span> : null}
                </div>
              </div>
            ) : (
              <div className="topbar-copy">
                <div className="eyebrow">Actionable workspace</div>
                <h2>{workspaceTitle}</h2>
                <p>{workspaceCopy}</p>
                {topbarContextLabel ? <div className="topbar-meta-row"><span className="soft-tag">{topbarContextLabel}</span></div> : null}
              </div>
            )}

            <div className="topbar-tools">
              <input
                className="client-search"
                ref={searchInputRef}
                placeholder={
                  workspaceView === "live"
                    ? "Search Apple Mail subject or sender"
                    : workspaceView === "analytics"
                      ? "Search client, domain, category, or kind"
                      : "Search subject, account, company, person, or follow-up"
                }
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                data-testid="global-search"
              />
              {(workspaceView === "inbox" || workspaceView === "live") && (
                <span className="soft-tag topbar-hint">⌘K</span>
              )}
              {workspaceView !== "live" && workspaceView !== "analytics" ? (
                <div className="segmented-control" data-testid="mailbox-scope-selector">
                  <button className={mailboxScope === "all" ? "active" : ""} onClick={() => setMailboxScope("all")} type="button">
                    All
                  </button>
                  <button className={mailboxScope === "personal" ? "active" : ""} onClick={() => setMailboxScope("personal")} type="button">
                    Personal
                  </button>
                  <button className={mailboxScope === "shared" ? "active" : ""} onClick={() => setMailboxScope("shared")} type="button">
                    Shared
                  </button>
                </div>
              ) : null}
              <button className="client-button secondary" data-shortcut="⌘J" onClick={() => setIsCommandPaletteOpen(true)} type="button">
                <Command size={16} />
                Commands
              </button>
              {workspaceView === "analytics" ? (
                <div className="segmented-control analytics-range" data-testid="analytics-range-selector">
                  {([1, 4, 6] as const).map((months) => (
                    <button
                      key={months}
                      className={selectedAnalyticsMonths === months ? "active" : ""}
                      onClick={() => {
                        setSelectedAnalyticsMonths(months);
                        void refreshOrganizationActivity(months);
                      }}
                      type="button"
                    >
                      {months}m
                    </button>
                  ))}
                </div>
              ) : workspaceView === "live" ? (
                thunderbirdStatus?.available ? (
                  <button className="client-button secondary" data-shortcut="R" onClick={() => void refreshThunderbirdStatus()}>
                    <RefreshCcw size={16} />
                    Refresh live
                  </button>
                ) : (
                  <button className="client-button secondary" data-shortcut="R" onClick={() => void refreshThunderbirdStatus()}>
                    <RefreshCcw size={16} />
                    Retry live
                  </button>
                )
              ) : (
                <>
                  <button
                    className="client-button primary"
                    onClick={() => router.push("/settings/accounts")}
                    type="button"
                  >
                    <MailPlus size={16} />
                    Accounts
                  </button>
                  <button className="client-button secondary" disabled={isSyncPending} onClick={() => void handleManualSync()}>
                    <FolderSync size={16} />
                    Sync mailbox
                  </button>
                </>
              )}
            </div>
          </header>

          {workspaceView === "accounts" ? (
            <section className="mailbox-strip">
              <div className="mailbox-strip-group">
                <span className="eyebrow">Accounts</span>
                <div className="mailbox-chip-row" data-testid="account-selector">
                  {accounts.length > 0 ? (
                    accounts.map((account) => (
                      <button
                        key={account.id}
                        className={`mailbox-chip ${account.id === selectedAccountId ? "active" : ""}`}
                        onClick={() => {
                          setSelectedAccountId(account.id);
                          setSelectedMailboxId(null);
                        }}
                        data-testid={`account-${account.email}`}
                      >
                        <strong>{account.displayName ?? account.email}</strong>
                        <span>{account.email}</span>
                      </button>
                    ))
                  ) : (
                    <div className="mailbox-chip empty">No imported account yet.</div>
                  )}
                </div>
              </div>

              <div className="mailbox-strip-group">
                <span className="eyebrow">Mailboxes</span>
                <div className="mailbox-chip-row">
                  {selectedAccount?.mailboxes.length ? (
                    <>
                      <button
                        className={`mailbox-chip subtle ${selectedMailboxId === null ? "active" : ""}`}
                        onClick={() => setSelectedMailboxId(null)}
                        type="button"
                      >
                        <strong>All mailboxes</strong>
                        <span>Unified queue for this account</span>
                      </button>
                      {selectedAccount.mailboxes.map((mailbox) => (
                        <button
                          key={mailbox.id}
                          className={`mailbox-chip subtle ${mailbox.id === selectedMailboxId ? "active" : ""}`}
                          onClick={() => setSelectedMailboxId(mailbox.id)}
                          type="button"
                        >
                          <strong>{mailbox.displayName}</strong>
                          <span>{mailbox.emailAddress}</span>
                        </button>
                      ))}
                    </>
                  ) : (
                    <div className="mailbox-chip empty">Choose an account to load mailboxes.</div>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          <div className={`mail-grid ${showInspectorPane ? "" : "no-inspector"}`.trim()}>
            <section className="thread-pane">
              {workspaceView === "inbox" ? (
                <>
                  <div className="pane-header">
                    <div>
                      <div className="eyebrow">Queue</div>
                      <h3>{inboxThreads.length} threads</h3>
                    </div>
                    <div className="segmented-control" data-testid="queue-selector">
                      <button className={inboxQueue === "needsReply" ? "active" : ""} onClick={() => setInboxQueue("needsReply")}>
                        Needs reply
                      </button>
                      <button className={inboxQueue === "waitingOnThem" ? "active" : ""} onClick={() => setInboxQueue("waitingOnThem")}>
                        Waiting
                      </button>
                      <button className={inboxQueue === "allThreads" ? "active" : ""} onClick={() => setInboxQueue("allThreads")}>
                        All
                      </button>
                    </div>
                  </div>

                  <div className="thread-list" data-testid="thread-list">
                    {inboxThreads.length > 0 ? (
                      inboxThreads.map((thread) => (
                        <button
                          key={thread.id}
                          className={`thread-row ${thread.id === selectedThreadId ? "active" : ""}`}
                          onClick={() => setSelectedThreadId(thread.id)}
                          data-row-id={thread.id}
                          data-testid={`thread-row-${thread.id}`}
                        >
                          <div className="thread-row-top">
                          <div className="thread-row-identity">
                              <div className="avatar-badge">
                                {monogram(thread.primaryOrganization?.name ?? thread.latestMessage?.fromName ?? thread.subject)}
                              </div>
                              <div className="thread-row-title-group">
                                <strong>{thread.primaryOrganization?.name ?? thread.latestMessage?.fromName ?? thread.subject}</strong>
                                <span className="thread-row-kicker">
                                  {thread.primaryOrganization?.primaryDomain ?? thread.latestMessage?.fromAddress ?? "Conversation"}
                                </span>
                              </div>
                            </div>
                            <div className="thread-row-aside">
                              <span>{formatShortDate(thread.replyState?.replyDueAt ?? thread.lastMessageAt)}</span>
                              {thread.unreadCount > 0 ? <span className="thread-row-dot" aria-hidden="true" /> : null}
                            </div>
                          </div>
                          <div className="thread-row-subject">{thread.subject}</div>
                          <p>{thread.latestMessage?.bodyPreview ?? "No preview yet."}</p>
                          <div className="thread-row-footer">
                            <span>{replyLabel(thread.replyState)}</span>
                            {thread.latestCategory ? <span>{categoryLabel(thread.latestCategory)}</span> : null}
                            {thread.unreadCount > 0 ? <span>{thread.unreadCount} unread</span> : null}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="empty-state compact">No threads match this queue yet.</div>
                    )}
                  </div>
                </>
              ) : null}

              {workspaceView === "followups" ? (
                <>
                  <div className="pane-header">
                    <div>
                      <div className="eyebrow">Reminder queue</div>
                      <h3>Follow-ups today</h3>
                    </div>
                    <span className="soft-tag">{filteredFollowUps.length} items</span>
                  </div>

                  <div className="thread-list" data-testid="followup-list">
                    {filteredFollowUps.length > 0 ? (
                      filteredFollowUps.map((task) => (
                        <button
                          key={task.id}
                          className={`thread-row ${task.thread.id === selectedThreadId ? "active" : ""}`}
                          onClick={() => setSelectedThreadId(task.thread.id)}
                          data-row-id={task.thread.id}
                          data-testid={`followup-row-${task.id}`}
                        >
                          <div className="thread-row-top">
                            <div className="thread-row-identity">
                              <div className="avatar-badge">
                                {monogram(task.organization?.name ?? task.contact?.displayName ?? task.title)}
                              </div>
                              <div className="thread-row-title-group">
                                <strong>{task.organization?.name ?? task.contact?.displayName ?? task.title}</strong>
                                <span className="thread-row-kicker">{task.mailbox.displayName}</span>
                              </div>
                            </div>
                            <span>{formatShortDate(task.dueAt)}</span>
                          </div>
                          <div className="thread-row-subject">{task.thread.subject}</div>
                          <p>{task.note ?? task.title}</p>
                          <div className="thread-row-meta">
                            <span className="status-tag warning">Due today</span>
                            <span className="soft-tag">{task.mailbox.displayName}</span>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="empty-state compact">No follow-ups due today.</div>
                    )}
                  </div>
                </>
              ) : null}

              {workspaceView === "accounts" ? (
                <>
                  <div className="pane-header">
                    <div>
                      <div className="eyebrow">Organizations</div>
                      <h3>Client pressure map</h3>
                    </div>
                    <span className="soft-tag">{filteredOrganizations.length} accounts</span>
                  </div>

                  <div className="thread-list" data-testid="accounts-list">
                    {filteredOrganizations.length > 0 ? (
                      filteredOrganizations.map((organization) => (
                        <button
                          key={organization.id}
                          className={`thread-row ${organization.id === selectedOrganization?.id ? "active" : ""}`}
                          onClick={() => setSelectedOrganizationId(organization.id)}
                          data-row-id={organization.id}
                          data-testid={`organization-row-${organization.id}`}
                        >
                          <div className="thread-row-top">
                            <div className="thread-row-identity">
                              <div className="avatar-badge">{monogram(organization.name)}</div>
                              <div className="thread-row-title-group">
                                <strong>{organization.name}</strong>
                                <span className="thread-row-kicker">{organization.kind.toLowerCase()}</span>
                              </div>
                            </div>
                            <span>{organization.primaryDomain ?? organization.kind.toLowerCase()}</span>
                          </div>
                          <div className="thread-row-meta spread">
                            <span className="soft-tag">Needs reply {organization.needsReply}</span>
                            <span className="soft-tag">Waiting {organization.waitingOnThem}</span>
                            <span className="soft-tag">Follow-ups {organization.followUps}</span>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="empty-state compact">Organizations appear after the client learns thread participants.</div>
                    )}
                  </div>
                </>
              ) : null}

              {workspaceView === "analytics" ? (
                <>
                  <div className="pane-header">
                    <div>
                      <div className="eyebrow">Client activity</div>
                      <h3>Most active clients</h3>
                    </div>
                    <span className="soft-tag">{filteredActivityOrganizations.length} organizations</span>
                  </div>

                  <div className="thread-list" data-testid="analytics-list">
                    {filteredActivityOrganizations.length > 0 ? (
                      filteredActivityOrganizations.map((organization) => (
                        <button
                          key={organization.organizationId}
                          className={`thread-row ${organization.organizationId === selectedActivityOrganization?.organizationId ? "active" : ""}`}
                          onClick={() => setSelectedActivityOrganizationId(organization.organizationId)}
                          data-row-id={organization.organizationId}
                          data-testid={`activity-row-${organization.organizationId}`}
                        >
                          <div className="thread-row-top">
                            <div className="thread-row-identity">
                              <div className="avatar-badge">{monogram(organization.name)}</div>
                              <div className="thread-row-title-group">
                                <strong>{organization.name}</strong>
                                <span className="thread-row-kicker">{organization.inferredKind.toLowerCase()}</span>
                              </div>
                            </div>
                            <span>{organization.primaryDomain ?? organization.kind.toLowerCase()}</span>
                          </div>
                          <div className="thread-row-subject">
                            {formatCount(organization.messageCount)} messages across {formatCount(organization.threadCount)} threads
                          </div>
                          <p>
                            {formatCount(organization.inboundMessageCount)} inbound, {formatCount(organization.outboundMessageCount)} outbound
                          </p>
                          <div className="thread-row-meta">
                            <span className={`status-tag ${activityTone(organization.inferredKind)}`}>{organization.inferredKind.toLowerCase()}</span>
                            <span className="soft-tag">{dominantCategoryLabel(organization.dominantCategory)}</span>
                            <span className="count-tag">{formatCount(organization.uniqueContactCount)} contacts</span>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="empty-state compact">No activity matches this window yet.</div>
                    )}
                  </div>
                </>
              ) : null}

              {workspaceView === "live" ? (
                <>
                  <div className="pane-header">
                    <div>
                      <div className="eyebrow">Apple Mail</div>
                      <h3>{liveHeaderName}</h3>
                    </div>
                    <div className="pane-header-meta">
                      <span className="soft-tag">{thunderbirdMessages.length} loaded</span>
                      <div className={`status-tag ${thunderbirdStatus?.available ? "active" : "warning"}`}>
                      {thunderbirdStatus?.available ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                      {thunderbirdStatus?.available
                        ? thunderbirdStatus?.authServerReachable
                          ? "Ready"
                          : "Mail.app ready"
                        : "Needs setup"}
                      </div>
                    </div>
                  </div>

                  <div className="live-chooser">
                    <select
                      className="client-input"
                      value={selectedThunderbirdAccountId ?? ""}
                      onChange={(event) => setSelectedThunderbirdAccountId(event.target.value || null)}
                    >
                      {thunderbirdAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>

                    <select
                      className="client-input"
                      value={selectedThunderbirdFolderPath ?? ""}
                      onChange={(event) => setSelectedThunderbirdFolderPath(event.target.value || null)}
                    >
                      {thunderbirdFolders.map((folder) => (
                        <option key={folder.path} value={folder.path}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="thread-list" data-testid="live-message-list">
                    {thunderbirdMessages.length > 0 ? (
                      thunderbirdMessages.map((message) => (
                        <button
                          key={`${message.folderPath}:${message.id}`}
                          className={`thread-row ${message.id === selectedThunderbirdMessageId ? "active" : ""}`}
                          onClick={() => selectLiveMessage(message)}
                          data-row-id={message.id}
                        >
                          <div className="thread-row-top">
                          <div className="thread-row-identity">
                              <div className="avatar-badge">{monogram(message.author)}</div>
                              <div className="thread-row-title-group">
                                <strong>{message.author}</strong>
                                <span className="thread-row-kicker">{message.folder}</span>
                              </div>
                            </div>
                            <div className="thread-row-aside">
                              <span>{formatShortDate(message.date)}</span>
                              {!message.read ? <span className="thread-row-dot" aria-hidden="true" /> : null}
                            </div>
                          </div>
                          <div className="thread-row-subject">{message.subject || "(no subject)"}</div>
                          <p>{message.recipients}</p>
                          <div className="thread-row-footer">
                            <span>{message.folder}</span>
                            {!message.read ? <span>unread</span> : null}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="empty-state compact">
                        {thunderbirdStatus?.available
                          ? "No live messages loaded yet."
                          : thunderbirdStatus?.authServerReachable
                            ? "Mail.app is reachable, but the live workspace still needs local Automation access."
                            : "Apple Mail live access is not ready yet on this Mac."}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </section>

            <section className="reader-pane" data-testid="reader-pane">
              {workspaceView === "accounts" ? (
                selectedOrganization ? (
                  <>
                    <div className="reader-hero">
                      <div>
                        <div className="eyebrow">Account overview</div>
                        <h3 data-testid="organization-title">{selectedOrganization.name}</h3>
                      </div>
                      <div className="hero-chip-group">
                        <span className="soft-tag">{selectedOrganization.primaryDomain ?? selectedOrganization.kind.toLowerCase()}</span>
                        <span className="soft-tag">Needs reply {selectedOrganization.needsReply}</span>
                        <span className="soft-tag">Follow-ups {selectedOrganization.followUps}</span>
                      </div>
                    </div>

                    <div className="reader-card">
                      <div className="pane-header">
                        <div>
                          <div className="eyebrow">Related threads</div>
                          <h3>Most active conversations</h3>
                        </div>
                      </div>

                      <div className="related-thread-grid">
                        {organizationThreads.length > 0 ? (
                          organizationThreads.slice(0, 8).map((thread) => (
                            <button
                              key={thread.id}
                              className={`mini-thread-card ${thread.id === selectedThreadId ? "active" : ""}`}
                              onClick={() => setSelectedThreadId(thread.id)}
                            >
                              <strong>{thread.subject}</strong>
                              <p>{thread.latestMessage?.bodyPreview ?? "No preview yet."}</p>
                              <span className={`status-tag ${replyTone(thread.replyState)}`}>{replyLabel(thread.replyState)}</span>
                            </button>
                          ))
                        ) : (
                          <div className="empty-state compact">No related threads found for this organization.</div>
                        )}
                      </div>
                    </div>

                    {selectedThread ? (
                      <div className="reader-card">
                        <div className="pane-header">
                          <div>
                            <div className="eyebrow">Focused thread</div>
                            <h3 data-testid="reader-subject">{selectedThread.subject}</h3>
                          </div>
                          <span className={`status-tag ${replyTone(selectedThread.replyState)}`}>{replyLabel(selectedThread.replyState)}</span>
                        </div>
                        <p className="reader-copy">{selectedThread.replyState?.reason ?? "No reply-state rationale yet."}</p>
                        <div className="message-stack">
                          {selectedThread.messages.map((message) => (
                            <article key={message.id} className="message-card">
                              <div className="message-card-head">
                                <div>
                                  <strong>{message.fromName ?? message.fromAddress ?? "Unknown sender"}</strong>
                                  <div className="subtle-line">{message.fromAddress ?? "No sender address"}</div>
                                </div>
                                <span className="soft-tag">{formatDate(message.receivedAt)}</span>
                              </div>
                              <p>{message.bodyText || message.bodyPreview || "(empty message)"}</p>
                            </article>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="empty-state">Select an organization to see related thread pressure and context.</div>
                )
              ) : workspaceView === "live" ? (
                selectedThunderbirdMessage ? (
                  <>
                    <div className="thread-reader-header">
                      <div className="thread-reader-title">
                        <div className="thread-reader-context">
                          <div className="avatar-badge reader-avatar">{liveSenderInitials}</div>
                          <div className="thread-reader-context-copy">
                            <div className="eyebrow">Conversation</div>
                            <strong>{selectedThunderbirdMessage.author}</strong>
                            <span>{liveSenderDomain || selectedThunderbirdMessage.accountName || "Mail.app"}</span>
                          </div>
                        </div>
                        <h3 data-testid="reader-subject">{selectedThunderbirdMessage.subject || "(no subject)"}</h3>
                        <p className="reader-copy">Live message from Mail.app. Read and respond in the same canvas.</p>
                      </div>
                      <div className="reader-actions">
                        <button className="icon-button" data-shortcut="R" type="button" aria-label="Reply">
                          <Reply size={15} />
                        </button>
                        <button className="icon-button" data-shortcut="A" type="button" aria-label="Reply all">
                          <ReplyAll size={15} />
                        </button>
                        <button className="icon-button" data-shortcut="F" type="button" aria-label="Forward">
                          <Forward size={15} />
                        </button>
                        <button className="icon-button" type="button" aria-label="More actions">
                          <MoreHorizontal size={15} />
                        </button>
                      </div>
                    </div>

                    <div className="reader-pill-row">
                      <span className="status-tag active">Apple Mail live</span>
                      <span className="soft-tag">{selectedThunderbirdMessage.folder}</span>
                      <span className="soft-tag">{selectedThunderbirdMessage.read ? "read" : "unread"}</span>
                      <span className="soft-tag">{selectedThunderbirdMessage.accountName ?? "Mail.app"}</span>
                    </div>

                    <div className="reader-card live-message-card reply-flow-card">
                      <div className="message-card mail-message message-focus-card">
                        <div className="message-card-head">
                          <div>
                            <strong>{selectedThunderbirdMessage.author}</strong>
                            <div className="subtle-line">{selectedThunderbirdMessage.recipients}</div>
                          </div>
                          <span className="soft-tag">{formatDate(selectedThunderbirdMessage.date)}</span>
                        </div>
                        <p>{selectedThunderbirdMessage.body || "(empty message)"}</p>
                      </div>
                      <div className="message-reply-zone">
                        <div className="reply-suggestions" data-testid="live-reply-suggestions">
                          {liveReplySuggestions.map((label) => (
                            <button key={label} className="reply-suggestion" onClick={() => setDraftText(label)} type="button">
                              {label}
                            </button>
                          ))}
                        </div>

                        <div className="inline-composer-panel">
                          <div className="composer-shell">
                            <div className="composer-envelope compact">
                              <span>Reply</span>
                              <strong>{selectedThunderbirdMessage.author}</strong>
                              <span className="composer-divider" aria-hidden="true" />
                              <span>{selectedThunderbirdMessage.accountName ?? "Mail.app"}</span>
                            </div>
                            <div className="template-row">
                              {liveReplySuggestions.map((label) => (
                                <button
                                  key={label}
                                  className="template-pill"
                                  onClick={() => setDraftText(label)}
                                  type="button"
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                            <textarea
                              className="draft-pad"
                              ref={draftPadRef}
                              value={draftText}
                              onChange={(event) => setDraftText(event.target.value)}
                              placeholder="Write a reply..."
                            />
                            <div className="composer-toolbar">
                              <div className="composer-meta">
                                <span className="soft-tag">Draft</span>
                              </div>
                              <div className="composer-actions">
                                <button className="client-button tertiary" data-shortcut="H" type="button">
                                  Send later
                                </button>
                                <button className="client-button tertiary" data-shortcut="M" type="button">
                                  Remind me
                                </button>
                                <button className="client-button primary" data-shortcut="⌘↵" type="button">
                                  Send
                                </button>
                              </div>
                            </div>
                            <div className="composer-footer-note">
                              <span>ai</span>
                              <p>Drafted in your voice from live context.</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">Choose a live Apple Mail message to inspect it here.</div>
                )
              ) : workspaceView === "analytics" ? (
                selectedActivityOrganization ? (
                  <>
                    <div className="reader-hero">
                      <div>
                        <div className="eyebrow">Activity summary</div>
                        <h3 data-testid="reader-subject">{selectedActivityOrganization.name}</h3>
                        <p className="reader-copy">
                          Based on the last {organizationActivity?.window.months ?? selectedAnalyticsMonths} months, this client has been especially active.
                        </p>
                      </div>
                      <div className="hero-chip-group">
                        <span className={`status-tag ${activityTone(selectedActivityOrganization.inferredKind)}`}>
                          {selectedActivityOrganization.inferredKind.toLowerCase()}
                        </span>
                        <span className="soft-tag">{dominantCategoryLabel(selectedActivityOrganization.dominantCategory)}</span>
                      </div>
                    </div>

                    <div className="reader-summary-grid">
                      <div className="summary-tile">
                        <span>Messages</span>
                        <strong>{formatCount(selectedActivityOrganization.messageCount)}</strong>
                      </div>
                      <div className="summary-tile">
                        <span>Threads</span>
                        <strong>{formatCount(selectedActivityOrganization.threadCount)}</strong>
                      </div>
                      <div className="summary-tile">
                        <span>Contacts</span>
                        <strong>{formatCount(selectedActivityOrganization.uniqueContactCount)}</strong>
                      </div>
                    </div>

                    <div className="reader-card">
                      <div className="pane-header">
                        <div>
                          <div className="eyebrow">Activity breakdown</div>
                          <h3>Inbound vs outbound</h3>
                        </div>
                      </div>
                      <div className="metric-stack">
                        <div className="metric-row">
                          <span>Inbound</span>
                          <strong>{formatCount(selectedActivityOrganization.inboundMessageCount)}</strong>
                        </div>
                        <div className="metric-row">
                          <span>Outbound</span>
                          <strong>{formatCount(selectedActivityOrganization.outboundMessageCount)}</strong>
                        </div>
                        <div className="metric-row">
                          <span>Last message</span>
                          <strong>{formatDate(selectedActivityOrganization.lastMessageAt)}</strong>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">Choose an organization to inspect its activity profile.</div>
                )
              ) : selectedThread ? (
                <>
                  <div className="thread-reader-header">
                    <div className="thread-reader-title">
                      <div className="thread-reader-context">
                        <div className="avatar-badge reader-avatar">{selectedPersonInitials}</div>
                        <div className="thread-reader-context-copy">
                          <div className="eyebrow">Conversation</div>
                          <strong>{selectedPerson?.displayName ?? selectedThreadOrganization?.name ?? "Selected thread"}</strong>
                          <span>{selectedThreadDomain || selectedThread.mailbox.displayName}</span>
                        </div>
                      </div>
                      <h3 data-testid="reader-subject">{selectedThread.subject}</h3>
                      <p className="reader-copy">{selectedThread.replyState?.reason ?? "No reply-state rationale yet."}</p>
                    </div>
                    <div className="reader-actions">
                      <button className="icon-button" data-shortcut="U" onClick={() => updateThreadReadState(selectedThread.unreadCount > 0)} type="button" aria-label="Toggle read state">
                        <CheckCircle2 size={15} />
                      </button>
                      <button className="icon-button" data-shortcut="E" onClick={() => updateThreadArchivedState(true)} type="button" aria-label="Archive thread">
                        <FolderArchive size={15} />
                      </button>
                      <button className="icon-button" data-shortcut="L" onClick={() => queueFollowUp(24, "Follow up tomorrow")} type="button" aria-label="Remind later">
                        <BellRing size={15} />
                      </button>
                      <button className="icon-button" data-shortcut="R" type="button" aria-label="Reply">
                        <Reply size={15} />
                      </button>
                      <button className="icon-button" data-shortcut="A" type="button" aria-label="Reply all">
                        <ReplyAll size={15} />
                      </button>
                      <button className="icon-button" data-shortcut="F" type="button" aria-label="Forward">
                        <Forward size={15} />
                      </button>
                      <button className="icon-button" type="button" aria-label="More actions">
                        <MoreHorizontal size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="reader-pill-row">
                    <span className={`status-tag ${replyTone(selectedThread.replyState)}`}>{replyLabel(selectedThread.replyState)}</span>
                    {latestThreadMessage?.category ? (
                      <span className="soft-tag">{categoryLabel(latestThreadMessage.category ?? null)}</span>
                    ) : null}
                    <span className="soft-tag">{selectedThread.mailbox.displayName}</span>
                    {selectedThread.mailbox.kind === "SHARED" ? <span className="soft-tag">Shared mailbox</span> : null}
                    {selectedThread.archivedAt ? <span className="soft-tag">Archived</span> : null}
                    {selectedThread.replyState?.replyDueAt ? (
                      <span className="soft-tag">Reply by {formatShortDate(selectedThread.replyState.replyDueAt)}</span>
                    ) : null}
                  </div>

                  <div className="reader-card assistant-card" data-testid="assistant-workbench">
                    <div className="pane-header">
                      <div>
                        <div className="eyebrow">Assistant workbench</div>
                        <h3>Grounded draft and next move</h3>
                      </div>
                      {isAssistantPending ? <LoaderCircle className="spin" size={18} /> : <BrainCircuit size={18} />}
                    </div>

                    {assistantData ? (
                      <>
                        <div className="assistant-route-row">
                          <span className="soft-tag">{assistantData.routing.providerLabel}</span>
                          <span className="soft-tag">{assistantData.routing.defaultModel}</span>
                          <span className="soft-tag">{assistantData.routing.routingMode === "AUTO" ? "Auto route" : "Explicit route"}</span>
                        </div>
                        <div className="assistant-brief-grid">
                          <div className="assistant-brief-card">
                            <span>Summary</span>
                            <p>{assistantData.briefing.summary}</p>
                          </div>
                          <div className="assistant-brief-card">
                            <span>Next move</span>
                            <p>{assistantData.briefing.suggestedNextStep}</p>
                          </div>
                          <div className="assistant-brief-card">
                            <span>Why it matters</span>
                            <p>{assistantData.briefing.whyItMatters}</p>
                          </div>
                          <div className="assistant-brief-card">
                            <span>Reply signal</span>
                            <p>{assistantData.briefing.replySignal}</p>
                          </div>
                        </div>
                        <div className="template-row">
                          {assistantData.draftSuggestions.map((draftSuggestion) => (
                            <button
                              key={draftSuggestion.id}
                              className="template-pill"
                              onClick={() => applySuggestedDraft(draftSuggestion.id)}
                              type="button"
                            >
                              {draftSuggestion.label}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="reader-copy">Assistant routing will appear here once the selected thread briefing loads.</p>
                    )}
                  </div>

                  <div className="reader-card conversation-card reply-flow-card">
                    {earlierThreadMessages.length ? (
                      <div className="thread-history-list">
                        {earlierThreadMessages.map((message) => (
                          <article key={message.id} className="thread-history-item" data-testid={`message-${message.id}`}>
                            <div className="thread-history-head">
                              <strong>{message.fromName ?? message.fromAddress ?? "Unknown sender"}</strong>
                              <span>{formatDate(message.receivedAt)}</span>
                            </div>
                            <p>{message.bodyPreview || message.bodyText || "(empty message)"}</p>
                          </article>
                        ))}
                      </div>
                    ) : null}

                    {latestThreadMessage ? (
                      <article
                        key={latestThreadMessage.id}
                        className="message-card mail-message message-focus-card"
                        data-testid={`message-${latestThreadMessage.id}`}
                      >
                        <div className="message-card-head">
                          <div>
                            <strong>{latestThreadMessage.fromName ?? latestThreadMessage.fromAddress ?? "Unknown sender"}</strong>
                            <div className="subtle-line">{latestThreadMessage.fromAddress ?? "No sender address"}</div>
                          </div>
                          <div className="message-meta-group">
                            <span className="soft-tag">{formatDate(latestThreadMessage.receivedAt)}</span>
                          </div>
                        </div>
                        <p>{latestThreadMessage.bodyText || latestThreadMessage.bodyPreview || "(empty message)"}</p>
                      </article>
                    ) : null}

                    <div className="message-reply-zone">
                      <div className="reply-suggestions" data-testid="archive-reply-suggestions">
                        {archiveReplySuggestions.map((label) => (
                          <button key={label} className="reply-suggestion" onClick={() => setDraftText(label)} type="button">
                            {label}
                          </button>
                        ))}
                      </div>

                      <div className="inline-composer-panel">
                        <div className="composer-shell">
                          <div className="composer-envelope compact">
                            <span>Reply</span>
                            <strong>{selectedPerson?.displayName ?? selectedPersonEmail ?? "recipient"}</strong>
                            <span className="composer-divider" aria-hidden="true" />
                            <span>{selectedThread.mailbox.displayName}</span>
                          </div>
                          <div className="template-row">
                            {draftTemplates.map((template) => (
                              <button
                                key={template.id}
                                className="template-pill"
                                onClick={() => setDraftText(template.body)}
                                type="button"
                              >
                                {template.label}
                              </button>
                            ))}
                            {assistantData?.draftSuggestions.map((draftSuggestion) => (
                              <button
                                key={`assistant-${draftSuggestion.id}`}
                                className="template-pill template-pill-accent"
                                onClick={() => applySuggestedDraft(draftSuggestion.id)}
                                type="button"
                              >
                                {draftSuggestion.label}
                              </button>
                            ))}
                          </div>
                          <textarea
                            className="draft-pad"
                            ref={draftPadRef}
                            value={draftText}
                            onChange={(event) => setDraftText(event.target.value)}
                            placeholder="Write a reply..."
                            data-testid="draft-pad"
                          />
                          <div className="composer-toolbar">
                            <div className="composer-meta">
                              <span className="soft-tag">Draft</span>
                              {assistantData ? <span className="soft-tag">{assistantData.routing.providerLabel}</span> : null}
                              {selectedThread.mailbox.kind === "SHARED" ? <span className="soft-tag">Shared mailbox</span> : null}
                            </div>
                            <div className="composer-actions">
                              <button className="client-button tertiary" data-shortcut="⌘C" onClick={() => void copyDraft()} type="button">
                                <Copy size={16} />
                                Copy
                              </button>
                              <button className="client-button tertiary" data-shortcut="H" onClick={() => queueFollowUp(24, "Send later follow-up")} type="button">
                                Send later
                              </button>
                              <button className="client-button tertiary" data-shortcut="L" onClick={() => queueFollowUp(72, "Check back later this week")} type="button">
                                Remind Friday
                              </button>
                              <button className="client-button primary" data-shortcut="⌘↵" type="button">
                                <SendHorizontal size={16} />
                                Send
                              </button>
                            </div>
                          </div>
                          <div className="composer-footer-note">
                            <span>ai</span>
                            <p>
                              {assistantData
                                ? `Grounded by ${assistantData.routing.providerLabel} on top of deterministic reply-state and mailbox context.`
                                : "Trained on your sent mail, templates, and account context."}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-state">Choose a thread from the left to open the reader and work the conversation.</div>
              )}
            </section>

            {showInspectorPane ? <aside className="inspector-pane">
              {workspaceView !== "live" && selectedThread ? (
                <>
                  <div className="inspector-card profile-card">
                    <div className="profile-identity">
                      <div className="profile-avatar">{selectedPersonInitials}</div>
                      <div className="profile-copy">
                        <div className="eyebrow">Primary contact</div>
                        <h3>{selectedPerson?.displayName ?? selectedPersonEmail ?? "Unknown contact"}</h3>
                        <p>{selectedPersonEmail ?? "No sender email available"}</p>
                      </div>
                    </div>

                    <div className="profile-chip-row">
                      <span className={`status-tag ${replyTone(selectedThread.replyState)}`}>{replyLabel(selectedThread.replyState)}</span>
                      <span className="soft-tag">{selectedThreadKind}</span>
                      <span className="soft-tag">{selectedThread.mailbox.displayName}</span>
                    </div>

                    <div className="profile-detail-list">
                      <div className="profile-detail-row">
                        <span>
                          <AtSign size={14} />
                          Email
                        </span>
                        <strong>{selectedPersonEmail ?? "Unknown"}</strong>
                      </div>
                      <div className="profile-detail-row">
                        <span>
                          <Building2 size={14} />
                          Organization
                        </span>
                        <strong>{selectedThreadOrganization?.name ?? "No linked company yet"}</strong>
                      </div>
                      <div className="profile-detail-row">
                        <span>
                          <Globe size={14} />
                          Domain
                        </span>
                        <strong>{selectedThreadDomain || "No domain detected"}</strong>
                      </div>
                      <div className="profile-detail-row">
                        <span>
                          <CircleUserRound size={14} />
                          Role
                        </span>
                        <strong>{selectedPerson?.contact?.roleTitle ?? "Unknown"}</strong>
                      </div>
                    </div>

                    <div className="profile-note">
                      <div className="eyebrow">Relationship note</div>
                      <p>
                        {selectedThread.replyState?.reason ??
                          "This thread is ready for contact context once more history and sent mail examples are indexed."}
                      </p>
                    </div>
                  </div>

                  <div className="inspector-card profile-support-card">
                    <div className="pane-header">
                      <div>
                        <div className="eyebrow">Reply plan</div>
                        <h3>Next move</h3>
                      </div>
                      <BrainCircuit size={18} />
                    </div>

                    <div className="metric-stack">
                      <div className="metric-row">
                        <span>Status</span>
                        <strong>{replyLabel(selectedThread.replyState)}</strong>
                      </div>
                      <div className="metric-row">
                        <span>Reply due</span>
                        <strong>{formatShortDate(selectedThread.replyState?.replyDueAt)}</strong>
                      </div>
                      <div className="metric-row">
                        <span>Suggested follow-up</span>
                        <strong>{formatShortDate(selectedThread.replyState?.suggestedFollowUpAt)}</strong>
                      </div>
                    </div>

                    {selectedThread.followUpTasks.length ? (
                      <div className="profile-followup-list">
                        {selectedThread.followUpTasks.map((task) => (
                          <div key={task.id} className="profile-followup-row">
                            <div>
                              <strong>{task.title}</strong>
                              <div className="subtle-line">{task.note ?? "Auto-created from reply state."}</div>
                            </div>
                            <span className="soft-tag">{formatShortDate(task.dueAt)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="profile-section">
                      <div className="eyebrow">Participants</div>
                      <div className="profile-followup-list">
                        {selectedThread.people.map((person) => (
                          <div key={person.id} className="profile-followup-row">
                            <div>
                              <strong>{person.displayName ?? person.emailAddress}</strong>
                              <div className="subtle-line">
                                {person.organization?.name ?? person.emailAddress}
                                {person.contact?.roleTitle ? ` · ${person.contact.roleTitle}` : ""}
                              </div>
                            </div>
                            <span className="soft-tag">{person.isMailbox ? "mailbox" : "contact"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              {workspaceView === "analytics" ? (
                <div className="inspector-card">
                  <div className="pane-header">
                    <div>
                      <div className="eyebrow">Interpretation</div>
                      <h3>What the ranking means</h3>
                    </div>
                    <BrainCircuit size={18} />
                  </div>
                  <div className="metric-stack">
                    <div className="metric-row">
                      <span>Window</span>
                      <strong>{organizationActivity ? `${organizationActivity.window.months} months` : `${selectedAnalyticsMonths} months`}</strong>
                    </div>
                    <div className="metric-row">
                      <span>Organizations</span>
                      <strong>{formatCount(organizationActivity?.summary.organizationCount ?? 0)}</strong>
                    </div>
                    <div className="metric-row">
                      <span>Total messages</span>
                      <strong>{formatCount(organizationActivity?.summary.messageCount ?? 0)}</strong>
                    </div>
                    <div className="metric-row">
                      <span>Unique contacts</span>
                      <strong>{formatCount(organizationActivity?.summary.uniqueContactCount ?? 0)}</strong>
                    </div>
                  </div>
                  <p className="inspector-copy">
                    This view is deterministic analytics, not model output. It answers which clients were busiest before we layer GPT-based summaries on top.
                  </p>
                </div>
              ) : null}

              {workspaceView === "live" && selectedThunderbirdMessage ? (
                <>
                  <div className="inspector-card profile-card">
                    <div className="profile-identity">
                      <div className="profile-avatar">{liveSenderInitials}</div>
                      <div className="profile-copy">
                        <div className="eyebrow">Live sender</div>
                        <h3>{selectedThunderbirdMessage.author}</h3>
                        <p>{liveSenderAddress || selectedThunderbirdMessage.accountName || "Mail.app contact"}</p>
                      </div>
                    </div>

                    <div className="profile-chip-row">
                      <span className="soft-tag">{selectedThunderbirdMessage.folder}</span>
                      <span className="soft-tag">{selectedThunderbirdMessage.read ? "read" : "unread"}</span>
                      <span className="soft-tag">{selectedThunderbirdMessage.accountName ?? "Apple Mail"}</span>
                    </div>

                    <div className="profile-detail-list">
                      <div className="profile-detail-row">
                        <span>
                          <AtSign size={14} />
                          Sender
                        </span>
                        <strong>{liveSenderAddress || "Unknown"}</strong>
                      </div>
                      <div className="profile-detail-row">
                        <span>
                          <Globe size={14} />
                          Domain
                        </span>
                        <strong>{liveSenderDomain || "No domain detected"}</strong>
                      </div>
                      <div className="profile-detail-row">
                        <span>
                          <MapPin size={14} />
                          Folder
                        </span>
                        <strong>{selectedThunderbirdMessage.folder}</strong>
                      </div>
                      <div className="profile-detail-row">
                        <span>
                          <PanelLeft size={14} />
                          Account
                        </span>
                        <strong>{selectedThunderbirdMessage.accountName ?? "Unknown"}</strong>
                      </div>
                      <div className="profile-detail-row">
                        <span>
                          <Archive size={14} />
                          Attachments
                        </span>
                        <strong>{selectedThunderbirdMessage.attachments.length}</strong>
                      </div>
                      <div className="profile-detail-row">
                        <span>
                          <Clock3 size={14} />
                          Priority
                        </span>
                        <strong>{selectedThunderbirdMessage.priority ?? "normal"}</strong>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              {workspaceView === "accounts" || workspaceView === "analytics" ? (
                <div className="inspector-card utility-card">
                  <div className="pane-header">
                    <div>
                      <div className="eyebrow">Operations</div>
                      <h3>Mailbox controls</h3>
                    </div>
                    <FolderSync size={18} />
                  </div>

                  <details className="client-details" open={workspaceView === "accounts"}>
                    <summary>
                      <PlugZap size={16} />
                      Apple Mail live source
                    </summary>
                    <div className="client-form">
                      <div className="subtle-line">
                        Smart Email Client reads live mail from Mail.app on this Mac. Make sure Mail.app is open and synced, then allow Automation access if macOS prompts for it.
                      </div>
                      <button
                        className="client-button secondary"
                        onClick={() => void refreshThunderbirdStatus()}
                        type="button"
                      >
                        <RefreshCcw size={16} />
                        Refresh status
                      </button>
                      {thunderbirdStatus?.setupSteps?.length ? (
                        <div className="soft-panel">
                          {thunderbirdStatus.setupSteps.map((step) => (
                            <div key={step} className="subtle-line">
                              {step}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </details>

                  <details className="client-details">
                    <summary>
                      <Upload size={16} />
                      Import archive
                    </summary>
                    <form className="client-form" onSubmit={(event) => void handleArchiveImport(event)}>
                      {!selectedMailboxId ? (
                        <>
                          <input
                            className="client-input"
                            placeholder="Mailbox email for imported archive"
                            type="email"
                            value={importMailboxEmail}
                            onChange={(event) => setImportMailboxEmail(event.target.value)}
                            required
                          />
                          <input
                            className="client-input"
                            placeholder="Optional mailbox display name"
                            value={importMailboxName}
                            onChange={(event) => setImportMailboxName(event.target.value)}
                          />
                        </>
                      ) : null}
                      <input
                        className="client-input"
                        accept=".olm,.eml,message/rfc822"
                        type="file"
                        onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                        required
                      />
                      <button className="client-button secondary" disabled={isImportPending} type="submit">
                        <Upload size={16} />
                        Import archive
                      </button>
                    </form>
                  </details>

                  <details className="client-details">
                    <summary>
                      <Archive size={16} />
                      Add shared mailbox
                    </summary>
                    <form className="client-form" onSubmit={(event) => void handleAddSharedMailbox(event)}>
                      <input
                        className="client-input"
                        placeholder="shared@company.com"
                        type="email"
                        value={sharedMailboxEmail}
                        onChange={(event) => setSharedMailboxEmail(event.target.value)}
                        required
                      />
                      <input
                        className="client-input"
                        placeholder="Optional display name"
                        value={sharedMailboxName}
                        onChange={(event) => setSharedMailboxName(event.target.value)}
                      />
                      <button className="client-button secondary" disabled={isMailboxPending || !selectedAccount} type="submit">
                        <SendHorizontal size={16} />
                        Save mailbox
                      </button>
                    </form>
                  </details>
                </div>
              ) : null}

              {workspaceView === "accounts" || workspaceView === "analytics" ? (
                <div className="inspector-card utility-card">
                <div className="pane-header">
                  <div>
                    <div className="eyebrow">Status</div>
                    <h3>System health</h3>
                  </div>
                  {thunderbirdStatus?.available ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
                </div>
                <div className="metric-stack">
                  <div className="metric-row">
                    <span>Apple Mail</span>
                    <strong>
                      {thunderbirdStatus?.available
                        ? thunderbirdStatus?.authServerReachable
                          ? "ready"
                          : "mail app only"
                        : "offline"}
                    </strong>
                  </div>
                  <div className="metric-row">
                    <span>Selected mailbox</span>
                    <strong>{selectedMailbox?.displayName ?? "None"}</strong>
                  </div>
                  <div className="metric-row">
                    <span>Latest import</span>
                    <strong>{selectedImportSummary?.sourceFilename ?? "None"}</strong>
                  </div>
                </div>
                <div className="subtle-line">{thunderbirdStatus?.bridgeUrl ?? "Mail.app Automation"}</div>
                </div>
              ) : null}

              {(workspaceView === "accounts" || workspaceView === "analytics") && thunderbirdSyncSources.length > 0 ? (
                <div className="inspector-card utility-card">
                  <div className="pane-header">
                    <div>
                      <div className="eyebrow">Connected sources</div>
                      <h3>Thunderbird mailboxes</h3>
                    </div>
                    <PlugZap size={18} />
                  </div>
                  <div className="context-list">
                    {thunderbirdSyncSources.map((source) => (
                      <div key={source.id} className="context-row">
                        <div>
                          <strong>{source.mailbox.displayName}</strong>
                          <div className="subtle-line">{source.mailbox.emailAddress}</div>
                        </div>
                        <span className="soft-tag">{source.lastSyncedAt ? formatShortDate(source.lastSyncedAt) : "Pending"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </aside> : null}
          </div>

          {isCommandPaletteOpen ? (
            <div className="command-palette-backdrop" onClick={() => setIsCommandPaletteOpen(false)} role="presentation">
              <div
                className="command-palette"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Command palette"
              >
                <div className="command-palette-head">
                  <Command size={16} />
                  <input
                    ref={commandInputRef}
                    className="command-palette-input"
                    onChange={(event) => setCommandQuery(event.target.value)}
                    placeholder="Jump to a workspace, action, or settings page"
                    value={commandQuery}
                  />
                </div>
                <div className="command-palette-list" data-testid="command-palette">
                  {commandItems.length ? (
                    commandItems.slice(0, 12).map((item) => (
                      <button
                        key={item.id}
                        className="command-palette-item"
                        onClick={() => {
                          item.run();
                          setIsCommandPaletteOpen(false);
                          setCommandQuery("");
                        }}
                        type="button"
                      >
                        <strong>{item.label}</strong>
                        <span>{item.hint}</span>
                      </button>
                    ))
                  ) : (
                    <div className="command-palette-empty">No commands match yet.</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
    </AppShell>
  );
}
