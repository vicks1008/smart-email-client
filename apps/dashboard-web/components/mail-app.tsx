"use client";

import {
  Archive,
  AtSign,
  BrainCircuit,
  Building2,
  CircleUserRound,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  FolderSync,
  Forward,
  Globe,
  Inbox,
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
  Sparkles,
  Upload,
  Users
} from "lucide-react";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent
} from "react";
import { toast } from "sonner";

import {
  addSharedMailbox,
  fetchAccounts,
  fetchAppleMailAccounts as fetchThunderbirdAccounts,
  fetchAppleMailFolders as fetchThunderbirdFolders,
  fetchAppleMailMessage as fetchThunderbirdMessage,
  fetchAppleMailRecentMessages as fetchThunderbirdRecentMessages,
  fetchAppleMailStatus as fetchThunderbirdStatus,
  fetchImports,
  fetchThread,
  fetchThreads,
  fetchThunderbirdDiscoveredMailboxes,
  fetchThunderbirdSyncSources,
  fetchOrganizationActivity,
  fetchWorkbench,
  getMicrosoftConnectUrl,
  queueSync,
  searchAppleMailMessages as searchThunderbirdMessages,
  syncAllThunderbirdMailboxes,
  syncThunderbirdMailbox,
  uploadArchive,
  type AccountSummary,
  type AppleMailAccount as ThunderbirdAccount,
  type AppleMailFolder as ThunderbirdFolder,
  type AppleMailMessageDetail as ThunderbirdMessageDetail,
  type AppleMailMessageSummary as ThunderbirdMessageSummary,
  type AppleMailStatus as ThunderbirdStatus,
  type ImportJobSummary,
  type ThreadDetail,
  type ThreadSummary,
  type ThunderbirdDiscoveredMailbox,
  type ThunderbirdSyncSource,
  type OrganizationActivityItem,
  type OrganizationActivityReport,
  type WorkbenchData
} from "../lib/api";

type WorkspaceView = "inbox" | "accounts" | "followups" | "analytics" | "live";
type InboxQueue = "needsReply" | "waitingOnThem" | "allThreads";

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

export function MailApp() {
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("inbox");
  const [inboxQueue, setInboxQueue] = useState<InboxQueue>("needsReply");
  const [search, setSearch] = useState("");
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [selectedAnalyticsMonths, setSelectedAnalyticsMonths] = useState<1 | 4 | 6>(4);
  const [draftText, setDraftText] = useState("");

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
      setThreads([]);
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
      return;
    }

    void loadThread(selectedThreadId);
  }, [selectedThreadId]);

  useEffect(() => {
    const templates = draftTemplatesForThread(selectedThread);
    setDraftText(templates[0]?.body ?? "");
  }, [selectedThreadId, selectedThread]);

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

  async function refreshArchiveAccounts() {
    setLoading(true);

    try {
      const data = await fetchAccounts();
      setAccounts(data.accounts);

      startTransition(() => {
        const currentAccountId = selectedAccountId ?? data.accounts[0]?.id ?? null;
        const nextAccount =
          data.accounts.find((account) => account.id === currentAccountId) ?? data.accounts[0] ?? null;
        const nextMailboxId =
          nextAccount?.mailboxes.find((mailbox) => mailbox.id === selectedMailboxId)?.id ??
          nextAccount?.mailboxes[0]?.id ??
          null;

        setSelectedAccountId(nextAccount?.id ?? null);
        setSelectedMailboxId(nextMailboxId);
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load imported accounts.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshThreads(mailboxId: string) {
    try {
      const data = await fetchThreads(mailboxId);
      setThreads(data.threads);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load threads.");
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

    if (selectedAccount.provider !== "MICROSOFT") {
      toast.error("Archive-only accounts do not support live OAuth sync.");
      return;
    }

    startSyncTransition(async () => {
      try {
        const result = await queueSync(selectedAccount.id);
        toast.success(`Queued ${result.queued} mailbox sync${result.queued === 1 ? "" : "s"}.`);
        await refreshArchiveAccounts();
        await refreshWorkbench(selectedMailboxId ?? undefined);
        if (selectedMailboxId) {
          await refreshThreads(selectedMailboxId);
        }
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
    if (!normalizedQuery) {
      return threads;
    }

    return threads.filter((thread) => threadMatchesQuery(thread, normalizedQuery));
  }, [normalizedQuery, threads]);

  const filteredNeedsReply = useMemo(() => {
    const items = workbench?.needsReply ?? [];
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((thread) => threadMatchesQuery(thread, normalizedQuery));
  }, [normalizedQuery, workbench]);

  const filteredWaiting = useMemo(() => {
    const items = workbench?.waitingOnThem ?? [];
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((thread) => threadMatchesQuery(thread, normalizedQuery));
  }, [normalizedQuery, workbench]);

  const filteredFollowUps = useMemo(() => {
    const items = workbench?.followUpToday ?? [];
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((task) =>
      [task.title, task.note ?? "", task.organization?.name ?? "", task.thread.subject, task.contact?.displayName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [normalizedQuery, workbench]);

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

    if (inboxQueue === "needsReply" && filteredNeedsReply.length === 0 && allArchiveThreads.length > 0) {
      setInboxQueue("allThreads");
    }
  }, [allArchiveThreads.length, filteredNeedsReply.length, inboxQueue, workspaceView]);

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

  return (
    <main className="client-shell">
      <div className="client-app" data-workspace={workspaceView}>
        <aside className="client-nav" data-testid="client-nav">
          <div className="nav-brand">
            <div className="nav-mark">
              <Sparkles size={18} />
            </div>
            <div>
              <div className="eyebrow">AI email client</div>
              <h1>Smart Mail</h1>
            </div>
          </div>

          <div className="nav-group">
            <button className={`nav-button ${workspaceView === "inbox" ? "active" : ""}`} onClick={() => setWorkspaceView("inbox")} data-testid="workspace-nav-inbox">
              <Inbox size={18} />
              <span>Inbox</span>
            </button>
            <button className={`nav-button ${workspaceView === "accounts" ? "active" : ""}`} onClick={() => setWorkspaceView("accounts")} data-testid="workspace-nav-accounts">
              <Building2 size={18} />
              <span>Accounts</span>
            </button>
            <button className={`nav-button ${workspaceView === "followups" ? "active" : ""}`} onClick={() => setWorkspaceView("followups")} data-testid="workspace-nav-followups">
              <Clock3 size={18} />
              <span>Follow-ups</span>
            </button>
            <button className={`nav-button ${workspaceView === "analytics" ? "active" : ""}`} onClick={() => setWorkspaceView("analytics")} data-testid="workspace-nav-analytics">
              <BrainCircuit size={18} />
              <span>Analytics</span>
            </button>
            <button className={`nav-button ${workspaceView === "live" ? "active" : ""}`} onClick={() => setWorkspaceView("live")} data-testid="workspace-nav-live">
              <PlugZap size={18} />
              <span>Live</span>
            </button>
          </div>

          <div className="nav-stats">
            <div className="nav-stat">
              <span>Needs reply</span>
              <strong>{workbench?.summary.needsReply ?? 0}</strong>
            </div>
            <div className="nav-stat">
              <span>Waiting</span>
              <strong>{workbench?.summary.waitingOnThem ?? 0}</strong>
            </div>
            <div className="nav-stat">
              <span>Due today</span>
              <strong>{workbench?.summary.followUpToday ?? 0}</strong>
            </div>
          </div>
        </aside>

        <section className="client-main">
          <header className={`client-topbar ${workspaceView === "inbox" || workspaceView === "live" ? "utility" : ""}`}>
            {workspaceView === "inbox" || workspaceView === "live" ? (
              <div className="topbar-copy utility-copy">
                <div className="utility-title-row">
                  <h2>{workspaceTitle}</h2>
                  {topbarContextLabel ? <span className="soft-tag">{topbarContextLabel}</span> : null}
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
                  <button className="client-button secondary" onClick={() => void refreshThunderbirdStatus()}>
                    <RefreshCcw size={16} />
                    Refresh live
                  </button>
                ) : (
                  <button className="client-button secondary" onClick={() => void refreshThunderbirdStatus()}>
                    <RefreshCcw size={16} />
                    Retry live
                  </button>
                )
              ) : (
                <>
                  <button
                    className="client-button primary"
                    onClick={() => (window.location.href = getMicrosoftConnectUrl(`${window.location.origin}/mail`))}
                  >
                    <MailPlus size={16} />
                    Connect
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
                          setSelectedMailboxId(account.mailboxes[0]?.id ?? null);
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
                    selectedAccount.mailboxes.map((mailbox) => (
                      <button
                        key={mailbox.id}
                        className={`mailbox-chip subtle ${mailbox.id === selectedMailboxId ? "active" : ""}`}
                        onClick={() => setSelectedMailboxId(mailbox.id)}
                      >
                        <strong>{mailbox.displayName}</strong>
                        <span>{mailbox.emailAddress}</span>
                      </button>
                    ))
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
                          onClick={() => {
                            const folderType =
                              thunderbirdFolders.find((folder) => folder.path === message.folderPath)?.type ?? null;
                            setSelectedThunderbirdMessage(
                              seedLiveMessageDetail(message, selectedThunderbirdAccount?.name ?? null, folderType)
                            );
                            setSelectedThunderbirdFolderPath(message.folderPath);
                            setSelectedThunderbirdMessageId(message.id);
                          }}
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
                        <div className="eyebrow">Live message</div>
                        <h3 data-testid="reader-subject">{selectedThunderbirdMessage.subject || "(no subject)"}</h3>
                        <p className="reader-copy">Browsing Mail.app live. Draft assistance stays available in the same pane.</p>
                      </div>
                      <div className="reader-actions">
                        <button className="icon-button" type="button" aria-label="Reply">
                          <Reply size={15} />
                        </button>
                        <button className="icon-button" type="button" aria-label="Reply all">
                          <ReplyAll size={15} />
                        </button>
                        <button className="icon-button" type="button" aria-label="Forward">
                          <Forward size={15} />
                        </button>
                        <button className="icon-button" type="button" aria-label="More actions">
                          <MoreHorizontal size={15} />
                        </button>
                      </div>
                    </div>

                    <div className="reader-pill-row">
                      <span className="soft-tag">{selectedThunderbirdMessage.folder}</span>
                      <span className="soft-tag">{selectedThunderbirdMessage.read ? "read" : "unread"}</span>
                      <span className="soft-tag">{selectedThunderbirdMessage.accountName ?? "Mail.app"}</span>
                    </div>

                  <div className="reader-card live-message-card">
                      <div className="message-card mail-message">
                        <div className="message-card-head">
                          <div>
                            <strong>{selectedThunderbirdMessage.author}</strong>
                            <div className="subtle-line">{selectedThunderbirdMessage.recipients}</div>
                          </div>
                          <span className="soft-tag">{formatDate(selectedThunderbirdMessage.date)}</span>
                        </div>
                        <p>{selectedThunderbirdMessage.body || "(empty message)"}</p>
                      </div>
                    </div>

                    <div className="reply-suggestions" data-testid="live-reply-suggestions">
                      {liveReplySuggestions.map((label) => (
                        <button key={label} className="reply-suggestion" onClick={() => setDraftText(label)} type="button">
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="reader-card composer-card inline-composer-card">
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
                          value={draftText}
                          onChange={(event) => setDraftText(event.target.value)}
                          placeholder="Write a reply..."
                        />
                        <div className="composer-toolbar">
                          <div className="composer-meta">
                            <span className="soft-tag">Live draft</span>
                          </div>
                          <div className="composer-actions">
                            <button className="client-button tertiary" type="button">
                              Send later
                            </button>
                            <button className="client-button tertiary" type="button">
                              Remind me
                            </button>
                            <button className="client-button primary" type="button">
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
                      <div className="eyebrow">Conversation</div>
                      <h3 data-testid="reader-subject">{selectedThread.subject}</h3>
                      <p className="reader-copy">{selectedThread.replyState?.reason ?? "No reply-state rationale yet."}</p>
                    </div>
                    <div className="reader-actions">
                      <button className="icon-button" type="button" aria-label="Reply">
                        <Reply size={15} />
                      </button>
                      <button className="icon-button" type="button" aria-label="Reply all">
                        <ReplyAll size={15} />
                      </button>
                      <button className="icon-button" type="button" aria-label="Forward">
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
                    {selectedThread.replyState?.replyDueAt ? (
                      <span className="soft-tag">Reply by {formatShortDate(selectedThread.replyState.replyDueAt)}</span>
                    ) : null}
                  </div>

                  <div className="reader-card conversation-card">
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
                  </div>

                  <div className="reply-suggestions" data-testid="archive-reply-suggestions">
                    {archiveReplySuggestions.map((label) => (
                      <button key={label} className="reply-suggestion" onClick={() => setDraftText(label)} type="button">
                        {label}
                      </button>
                    ))}
                  </div>

                    <div className="reader-card composer-card inline-composer-card">
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
                      </div>
                      <textarea
                        className="draft-pad"
                        value={draftText}
                        onChange={(event) => setDraftText(event.target.value)}
                        placeholder="Write a reply..."
                        data-testid="draft-pad"
                      />
                      <div className="composer-toolbar">
                        <div className="composer-meta">
                          <span className="soft-tag">Draft</span>
                        </div>
                        <div className="composer-actions">
                          <button className="client-button tertiary" onClick={() => void copyDraft()} type="button">
                            <Copy size={16} />
                            Copy
                          </button>
                          <button className="client-button tertiary" type="button">
                            Send later
                          </button>
                          <button className="client-button primary" type="button">
                            <SendHorizontal size={16} />
                            Send
                          </button>
                        </div>
                      </div>
                      <div className="composer-footer-note">
                        <span>ai</span>
                        <p>Trained on your sent mail, templates, and account context.</p>
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
        </section>
      </div>
    </main>
  );
}
