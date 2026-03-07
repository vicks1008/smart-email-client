"use client";

import {
  Archive,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Flag,
  FolderSync,
  Inbox,
  MailPlus,
  PlugZap,
  RefreshCcw,
  SendHorizontal,
  ShieldAlert,
  Sparkles,
  Upload,
  Users
} from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import {
  addSharedMailbox,
  fetchAccounts,
  fetchImports,
  fetchThread,
  fetchThreads,
  fetchThunderbirdDiscoveredMailboxes,
  fetchThunderbirdAccounts,
  fetchThunderbirdFolders,
  fetchThunderbirdMessage,
  fetchThunderbirdRecentMessages,
  fetchThunderbirdSyncSources,
  fetchThunderbirdStatus,
  fetchWorkbench,
  getMicrosoftConnectUrl,
  queueSync,
  searchThunderbirdMessages,
  syncAllThunderbirdMailboxes,
  syncThunderbirdMailbox,
  uploadArchive,
  type AccountSummary,
  type ImportJobSummary,
  type ThreadDetail,
  type ThreadSummary,
  type ThunderbirdAccount,
  type ThunderbirdDiscoveredMailbox,
  type ThunderbirdFolder,
  type ThunderbirdMessageDetail,
  type ThunderbirdMessageSummary,
  type ThunderbirdSyncSource,
  type ThunderbirdStatus,
  type WorkbenchData
} from "../lib/api";

type SourceMode = "thunderbird" | "archive";
type ArchiveSurface = "needsReply" | "waitingOnThem" | "followUpToday" | "allThreads";

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not synced yet";
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

export function MailApp() {
  const [sourceMode, setSourceMode] = useState<SourceMode>("archive");
  const [archiveSurface, setArchiveSurface] = useState<ArchiveSurface>("needsReply");
  const [search, setSearch] = useState("");

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
  const [selectedThunderbirdCandidateEmail, setSelectedThunderbirdCandidateEmail] = useState<string>("");

  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [imports, setImports] = useState<ImportJobSummary[]>([]);
  const [workbench, setWorkbench] = useState<WorkbenchData | null>(null);
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
    if (selectedThunderbirdAccountId) {
      void refreshThunderbirdFolders(selectedThunderbirdAccountId);
    }
  }, [selectedThunderbirdAccountId]);

  useEffect(() => {
    if (sourceMode !== "thunderbird") {
      return;
    }

    void refreshThunderbirdMessages(selectedThunderbirdFolderPath ?? undefined, deferredSearch);
  }, [sourceMode, selectedThunderbirdFolderPath, deferredSearch]);

  useEffect(() => {
    if (!selectedThunderbirdMessageId || !selectedThunderbirdFolderPath || sourceMode !== "thunderbird") {
      setSelectedThunderbirdMessage(null);
      return;
    }

    void loadThunderbirdMessage(selectedThunderbirdMessageId, selectedThunderbirdFolderPath);
  }, [selectedThunderbirdMessageId, selectedThunderbirdFolderPath, sourceMode]);

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
    if (!selectedThreadId) {
      setSelectedThread(null);
      return;
    }

    void loadThread(selectedThreadId);
  }, [selectedThreadId]);

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
      }
    } catch (error) {
      setThunderbirdStatus({
        available: false,
        profilePaths: [],
        bridgeUrl: "http://127.0.0.1:8765",
        error: error instanceof Error ? error.message : "Thunderbird status check failed."
      });
    }
  }

  async function refreshThunderbirdDiscovery() {
    try {
      const [discovered, sources] = await Promise.all([
        fetchThunderbirdDiscoveredMailboxes(),
        fetchThunderbirdSyncSources()
      ]);
      setThunderbirdDiscoveredMailboxes(discovered.mailboxes);
      setThunderbirdSyncSources(sources.sources);
      setSelectedThunderbirdCandidateEmail((current) => current || discovered.mailboxes[0]?.mailboxEmail || "");
    } catch {
      setThunderbirdDiscoveredMailboxes([]);
      setThunderbirdSyncSources([]);
    }
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
      toast.error(error instanceof Error ? error.message : "Failed to load Thunderbird folders.");
    }
  }

  async function refreshThunderbirdMessages(folderPath?: string, query?: string) {
    try {
      const data =
        query && query.trim().length > 0
          ? await searchThunderbirdMessages(query, folderPath)
          : await fetchThunderbirdRecentMessages(folderPath);

      setThunderbirdMessages(data.messages);
      setSelectedThunderbirdMessageId((current) => {
        const retained = data.messages.find((message) => message.id === current)?.id;
        return retained ?? data.messages[0]?.id ?? null;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load Thunderbird messages.");
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
      toast.error(error instanceof Error ? error.message : "Failed to load Thunderbird message.");
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
        setSourceMode("archive");
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
        toast.success(`Synced ${result.syncs.length} discovered Thunderbird mailbox${result.syncs.length === 1 ? "" : "es"} into the workbench.`);
        await refreshThunderbirdDiscovery();
        await refreshArchiveAccounts();
        await refreshWorkbench();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Thunderbird bulk sync failed.");
      }
    });
  }

  const allArchiveThreads = useMemo(() => {
    const normalizedQuery = deferredSearch.trim().toLowerCase();

    if (!normalizedQuery) {
      return threads;
    }

    return threads.filter((thread) => {
      const participants = thread.participants
        .map((participant) => `${participant.name} ${participant.address}`)
        .join(" ")
        .toLowerCase();
      const organization = `${thread.primaryOrganization?.name ?? ""} ${thread.primaryOrganization?.primaryDomain ?? ""}`.toLowerCase();

      return (
        thread.subject.toLowerCase().includes(normalizedQuery) ||
        thread.latestMessage?.bodyPreview.toLowerCase().includes(normalizedQuery) ||
        participants.includes(normalizedQuery) ||
        organization.includes(normalizedQuery)
      );
    });
  }, [deferredSearch, threads]);

  const filteredWorkbenchNeedsReply = useMemo(() => {
    const normalizedQuery = deferredSearch.trim().toLowerCase();
    const items = workbench?.needsReply ?? [];

    if (!normalizedQuery) {
      return items;
    }

    return items.filter((thread) => {
      const haystack = [
        thread.subject,
        thread.latestMessage?.bodyPreview ?? "",
        thread.primaryOrganization?.name ?? "",
        thread.primaryOrganization?.primaryDomain ?? "",
        thread.latestMessage?.fromName ?? "",
        thread.latestMessage?.fromAddress ?? ""
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [deferredSearch, workbench]);

  const filteredWorkbenchWaiting = useMemo(() => {
    const normalizedQuery = deferredSearch.trim().toLowerCase();
    const items = workbench?.waitingOnThem ?? [];

    if (!normalizedQuery) {
      return items;
    }

    return items.filter((thread) => {
      const haystack = [
        thread.subject,
        thread.latestMessage?.bodyPreview ?? "",
        thread.primaryOrganization?.name ?? "",
        thread.primaryOrganization?.primaryDomain ?? ""
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [deferredSearch, workbench]);

  const filteredFollowUps = useMemo(() => {
    const normalizedQuery = deferredSearch.trim().toLowerCase();
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
  }, [deferredSearch, workbench]);

  const archiveItems =
    archiveSurface === "needsReply"
      ? filteredWorkbenchNeedsReply
      : archiveSurface === "waitingOnThem"
        ? filteredWorkbenchWaiting
        : archiveSurface === "followUpToday"
          ? []
          : allArchiveThreads;

  useEffect(() => {
    if (sourceMode !== "archive") {
      return;
    }

    if (archiveSurface === "followUpToday") {
      setSelectedThreadId((current) => {
        const retained = filteredFollowUps.find((task) => task.thread.id === current)?.thread.id;
        return retained ?? filteredFollowUps[0]?.thread.id ?? null;
      });
      return;
    }

    setSelectedThreadId((current) => {
      const retained = archiveItems.find((thread) => thread.id === current)?.id;
      return retained ?? archiveItems[0]?.id ?? null;
    });
  }, [archiveItems, archiveSurface, filteredFollowUps, sourceMode]);

  const selectedImportSummary = imports[0] ?? null;
  const liveHeaderName =
    thunderbirdFolders.find((folder) => folder.path === selectedThunderbirdFolderPath)?.name ??
    selectedThunderbirdAccount?.name ??
    "Thunderbird";

  return (
    <main className="mail-shell modern-shell">
      <div className="app-shell">
        <aside className="app-rail">
          <div className="rail-brand">
            <div className="rail-brand-mark">
              <Sparkles size={18} />
            </div>
            <div>
              <div className="eyebrow">Phase 2</div>
              <h1 className="rail-title">Smart Mail</h1>
            </div>
          </div>

          <div className="rail-section">
            <button
              className={`rail-button ${sourceMode === "archive" ? "active" : ""}`}
              onClick={() => setSourceMode("archive")}
            >
              <Inbox size={18} />
              <span>Workbench</span>
            </button>
            <button
              className={`rail-button ${sourceMode === "thunderbird" ? "active" : ""}`}
              onClick={() => setSourceMode("thunderbird")}
            >
              <PlugZap size={18} />
              <span>Live</span>
            </button>
          </div>

          {sourceMode === "archive" ? (
            <div className="rail-section">
              <div className="rail-label">Queues</div>
              <button
                className={`rail-button ${archiveSurface === "needsReply" ? "active" : ""}`}
                onClick={() => setArchiveSurface("needsReply")}
              >
                <Inbox size={18} />
                <span>Needs Reply</span>
              </button>
              <button
                className={`rail-button ${archiveSurface === "waitingOnThem" ? "active" : ""}`}
                onClick={() => setArchiveSurface("waitingOnThem")}
              >
                <SendHorizontal size={18} />
                <span>Waiting</span>
              </button>
              <button
                className={`rail-button ${archiveSurface === "followUpToday" ? "active" : ""}`}
                onClick={() => setArchiveSurface("followUpToday")}
              >
                <Clock3 size={18} />
                <span>Follow-ups</span>
              </button>
              <button
                className={`rail-button ${archiveSurface === "allThreads" ? "active" : ""}`}
                onClick={() => setArchiveSurface("allThreads")}
              >
                <Archive size={18} />
                <span>All Mail</span>
              </button>
            </div>
          ) : null}

          <div className="rail-footer">
            {sourceMode === "archive" ? (
              <>
                <div className="rail-metric">
                  <span>Needs reply</span>
                  <strong>{workbench?.summary.needsReply ?? 0}</strong>
                </div>
                <div className="rail-metric">
                  <span>Overdue</span>
                  <strong>{workbench?.summary.overdue ?? 0}</strong>
                </div>
                <div className="rail-metric">
                  <span>Follow up today</span>
                  <strong>{workbench?.summary.followUpToday ?? 0}</strong>
                </div>
              </>
            ) : (
              <div className="rail-live-status">
                <div className={`status-pill ${thunderbirdStatus?.available ? "active" : "warning"}`}>
                  {thunderbirdStatus?.available ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                  {thunderbirdStatus?.available ? "Bridge online" : "Bridge offline"}
                </div>
                <div className="muted">{thunderbirdStatus?.bridgeUrl ?? "http://127.0.0.1:8765"}</div>
              </div>
            )}
          </div>
        </aside>

        <section className="workspace-shell">
          <header className="workspace-header">
            <div className="workspace-heading">
              <div className="eyebrow">{sourceMode === "archive" ? "Action-first inbox" : "Live mailbox stream"}</div>
              <h2 className="workspace-title">
                {sourceMode === "archive"
                  ? archiveSurface === "needsReply"
                    ? "Needs Reply"
                    : archiveSurface === "waitingOnThem"
                      ? "Waiting on Client"
                      : archiveSurface === "followUpToday"
                        ? "Follow Up Today"
                        : "All Threads"
                  : liveHeaderName}
              </h2>
              <p className="workspace-copy">
                {sourceMode === "archive"
                  ? "Keep the list focused on the next action instead of raw mailbox plumbing."
                  : "Thunderbird stays available for live folder browsing while the archive side powers intelligence."}
              </p>
            </div>

            <div className="workspace-toolbar">
              <input
                className="search search-wide"
                placeholder={
                  sourceMode === "archive"
                    ? "Search subject, company, person, or follow-up"
                    : "Search Thunderbird subject, sender, or recipient"
                }
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />

              {sourceMode === "archive" ? (
                <>
                  <button
                    className="button primary"
                    onClick={() => (window.location.href = getMicrosoftConnectUrl(`${window.location.origin}/mail`))}
                  >
                    <MailPlus size={16} />
                    Connect
                  </button>
                  <button className="button secondary" disabled={isSyncPending} onClick={() => void handleManualSync()}>
                    <RefreshCcw size={16} />
                    Sync
                  </button>
                </>
              ) : (
                <button className="button secondary" onClick={() => void refreshThunderbirdStatus()}>
                  <RefreshCcw size={16} />
                  Refresh
                </button>
              )}
            </div>
          </header>

          <div className="workspace-summary">
            {sourceMode === "archive" ? (
              <>
                <div className="summary-card accent">
                  <span className="summary-label">Mailbox</span>
                  <strong>{selectedMailbox?.displayName ?? "No mailbox selected"}</strong>
                  <span className="muted">{selectedMailbox?.emailAddress ?? "Choose an account to populate queues."}</span>
                </div>
                <div className="summary-card">
                  <span className="summary-label">By client</span>
                  <strong>{workbench?.byOrganization.length ?? 0} active organizations</strong>
                  <span className="muted">Clients and accounts are grouped from participants and domains.</span>
                </div>
                <div className="summary-card">
                  <span className="summary-label">Latest import</span>
                  <strong>{selectedImportSummary?.sourceFilename ?? "No recent import"}</strong>
                  <span className="muted">
                    {selectedImportSummary
                      ? `${selectedImportSummary.importedMessages} messages · ${selectedImportSummary.status.toLowerCase()}`
                      : "Import .eml or .olm to backfill history."}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="summary-card accent">
                  <span className="summary-label">Live source</span>
                  <strong>{selectedThunderbirdAccount?.name ?? "Thunderbird"}</strong>
                  <span className="muted">{thunderbirdStatus?.available ? "Local bridge connected." : "Local bridge offline."}</span>
                </div>
                <div className="summary-card">
                  <span className="summary-label">Folders</span>
                  <strong>{thunderbirdFolders.length}</strong>
                  <span className="muted">Switch folders without leaving the reading workspace.</span>
                </div>
                <div className="summary-card">
                  <span className="summary-label">Messages</span>
                  <strong>{thunderbirdMessages.length}</strong>
                  <span className="muted">The live view stays intentionally lightweight.</span>
                </div>
              </>
            )}
          </div>

          <div className="workspace-body">
            <section className="list-pane">
              {sourceMode === "archive" ? (
                <>
                  <div className="stack-card">
                    <div className="card-heading">
                      <div>
                        <div className="eyebrow">Sources</div>
                        <h3 className="panel-title">Accounts and mailboxes</h3>
                      </div>
                      <button className="button secondary" disabled={loading} onClick={() => void refreshArchiveAccounts()}>
                        <FolderSync size={16} />
                        Refresh
                      </button>
                    </div>

                    {accounts.length > 0 ? (
                      <div className="selector-stack">
                        {accounts.map((account) => (
                          <button
                            key={account.id}
                            className={`selector-button ${account.id === selectedAccountId ? "selected" : ""}`}
                            onClick={() => {
                              setSelectedAccountId(account.id);
                              setSelectedMailboxId(account.mailboxes[0]?.id ?? null);
                            }}
                          >
                            <div>
                              <strong>{account.displayName ?? account.email}</strong>
                              <div className="muted">{account.email}</div>
                            </div>
                            <span className={`status-pill ${statusClass(account.status)}`}>
                              {account.status === "ACTIVE" ? "Active" : "Needs attention"}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-inline">No imported account yet.</div>
                    )}

                    {selectedAccount?.mailboxes.length ? (
                      <div className="chip-row">
                        {selectedAccount.mailboxes.map((mailbox) => (
                          <button
                            key={mailbox.id}
                            className={`chip-button ${mailbox.id === selectedMailboxId ? "selected" : ""}`}
                            onClick={() => setSelectedMailboxId(mailbox.id)}
                          >
                            {mailbox.displayName}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="stack-card">
                    <div className="card-heading">
                      <div>
                        <div className="eyebrow">Queue</div>
                        <h3 className="panel-title">
                          {archiveSurface === "needsReply"
                            ? "Needs Reply"
                            : archiveSurface === "waitingOnThem"
                              ? "Waiting on Client"
                              : archiveSurface === "followUpToday"
                                ? "Follow Up Today"
                                : "All Threads"}
                        </h3>
                      </div>
                      <span className="meta-pill">
                        {archiveSurface === "followUpToday" ? filteredFollowUps.length : archiveItems.length} items
                      </span>
                    </div>

                    <div className="thread-items">
                      {archiveSurface === "followUpToday" ? (
                        filteredFollowUps.length > 0 ? (
                          filteredFollowUps.map((task) => (
                            <button
                              key={task.id}
                              className={`thread-button ${task.thread.id === selectedThreadId ? "selected" : ""}`}
                              onClick={() => setSelectedThreadId(task.thread.id)}
                            >
                              <div className="list-item">
                                <div className="list-item-top">
                                  <strong>{task.title}</strong>
                                  <ChevronRight size={16} />
                                </div>
                                <p className="thread-preview">{task.note ?? task.thread.subject}</p>
                                <div className="thread-row-meta">
                                  <span className="meta-pill">{task.organization?.name ?? task.contact?.displayName ?? "Follow-up"}</span>
                                  <span className="status-pill warning">Due {formatShortDate(task.dueAt)}</span>
                                </div>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="empty-inline">No follow-ups due today.</div>
                        )
                      ) : archiveItems.length > 0 ? (
                        archiveItems.map((thread) => (
                          <button
                            key={thread.id}
                            className={`thread-button ${thread.id === selectedThreadId ? "selected" : ""}`}
                            onClick={() => setSelectedThreadId(thread.id)}
                          >
                            <div className="list-item">
                              <div className="list-item-top">
                                <strong>{thread.subject}</strong>
                                <ChevronRight size={16} />
                              </div>
                              <p className="thread-preview">{thread.latestMessage?.bodyPreview ?? "No preview yet."}</p>
                              <div className="thread-row-meta">
                                <span className="meta-pill">
                                  {thread.primaryOrganization?.name ??
                                    thread.latestMessage?.fromName ??
                                    thread.latestMessage?.fromAddress ??
                                    "Unknown sender"}
                                </span>
                                <span className={`status-pill ${replyTone(thread.replyState)}`}>{replyLabel(thread.replyState)}</span>
                              </div>
                              <div className="thread-row-meta">
                                {thread.latestCategory ? <span className="mailbox-pill">{categoryLabel(thread.latestCategory)}</span> : null}
                                <span className="meta-pill">
                                  {thread.replyState?.replyDueAt
                                    ? `Due ${formatShortDate(thread.replyState.replyDueAt)}`
                                    : formatShortDate(thread.lastMessageAt)}
                                </span>
                              </div>
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="empty-inline">No queue items match this view yet.</div>
                      )}
                    </div>
                  </div>

                  <div className="stack-card">
                    <div className="card-heading">
                      <div>
                        <div className="eyebrow">Operations</div>
                        <h3 className="panel-title">Import and shared inboxes</h3>
                      </div>
                    </div>

                    <details className="collapsible">
                      <summary>
                        <Flag size={16} />
                        Add shared mailbox
                      </summary>
                      <form className="form" onSubmit={(event) => void handleAddSharedMailbox(event)}>
                        <input
                          className="input"
                          placeholder="shared@company.com"
                          type="email"
                          value={sharedMailboxEmail}
                          onChange={(event) => setSharedMailboxEmail(event.target.value)}
                          required
                        />
                        <input
                          className="input"
                          placeholder="Optional display name"
                          value={sharedMailboxName}
                          onChange={(event) => setSharedMailboxName(event.target.value)}
                        />
                        <button className="button secondary" disabled={isMailboxPending || !selectedAccount} type="submit">
                          <Flag size={16} />
                          Save mailbox
                        </button>
                      </form>
                    </details>

                    <details className="collapsible">
                      <summary>
                        <Upload size={16} />
                        Import archive
                      </summary>
                      <form className="form" onSubmit={(event) => void handleArchiveImport(event)}>
                        {!selectedMailboxId ? (
                          <>
                            <input
                              className="input"
                              placeholder="Mailbox email for imported archive"
                              type="email"
                              value={importMailboxEmail}
                              onChange={(event) => setImportMailboxEmail(event.target.value)}
                              required
                            />
                            <input
                              className="input"
                              placeholder="Optional mailbox display name"
                              value={importMailboxName}
                              onChange={(event) => setImportMailboxName(event.target.value)}
                            />
                          </>
                        ) : null}
                        <input
                          className="input"
                          accept=".olm,.eml,message/rfc822"
                          type="file"
                          onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                          required
                        />
                        <button className="button secondary" disabled={isImportPending} type="submit">
                          <Upload size={16} />
                          Import
                        </button>
                      </form>
                    </details>

                    <details className="collapsible">
                      <summary>
                        <PlugZap size={16} />
                        Sync from Thunderbird
                      </summary>
                      <form className="form" onSubmit={(event) => void handleThunderbirdImport(event)}>
                        <div className="muted">
                          Syncs Inbox and Sent from a discovered Thunderbird mailbox into the workbench. Choose a discovered mailbox below, or override manually for edge cases like a shared inbox that Thunderbird does not expose as a separate identity.
                        </div>
                        {thunderbirdDiscoveredMailboxes.length > 0 ? (
                          <select
                            className="input"
                            value={selectedThunderbirdCandidateEmail}
                            onChange={(event) => {
                              const nextEmail = event.target.value;
                              setSelectedThunderbirdCandidateEmail(nextEmail);
                              const candidate =
                                thunderbirdDiscoveredMailboxes.find((entry) => entry.mailboxEmail === nextEmail) ?? null;
                              setThunderbirdImportMailboxEmail(candidate?.isTeamMailbox ? candidate.mailboxEmail : "");
                              setThunderbirdImportMailboxName("");
                              setSelectedThunderbirdAccountId(candidate?.thunderbirdAccountId ?? null);
                            }}
                          >
                            {thunderbirdDiscoveredMailboxes.map((candidate) => (
                              <option key={`${candidate.thunderbirdAccountId}:${candidate.mailboxEmail}`} value={candidate.mailboxEmail}>
                                {candidate.mailboxDisplayName} · {candidate.mailboxEmail}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="meta-pill">No discovered Thunderbird mailboxes yet. Open Thunderbird and refresh Live first.</div>
                        )}
                        <div className="meta-pill">
                          {selectedThunderbirdCandidateEmail
                            ? `Target mailbox: ${selectedThunderbirdCandidateEmail}`
                            : selectedThunderbirdAccount
                              ? `Selected Thunderbird account: ${selectedThunderbirdAccount.name}`
                              : "Select a Thunderbird mailbox first."}
                        </div>
                        <input
                          className="input"
                          placeholder="Optional mailbox email override"
                          type="email"
                          value={thunderbirdImportMailboxEmail}
                          onChange={(event) => setThunderbirdImportMailboxEmail(event.target.value)}
                        />
                        <input
                          className="input"
                          placeholder="Optional mailbox display name"
                          value={thunderbirdImportMailboxName}
                          onChange={(event) => setThunderbirdImportMailboxName(event.target.value)}
                        />
                        <button
                          className="button secondary"
                          disabled={
                            isThunderbirdImportPending ||
                            (!selectedThunderbirdAccountId && thunderbirdDiscoveredMailboxes.length === 0)
                          }
                          type="submit"
                        >
                          <PlugZap size={16} />
                          Sync selected mailbox
                        </button>
                        <button
                          className="button secondary"
                          disabled={isThunderbirdBulkImportPending || thunderbirdDiscoveredMailboxes.length === 0}
                          onClick={() => void handleThunderbirdBulkImport()}
                          type="button"
                        >
                          <Users size={16} />
                          Sync all discovered
                        </button>
                      </form>
                    </details>

                    <details className="collapsible">
                      <summary>
                        <FolderSync size={16} />
                        Connected Thunderbird sources
                      </summary>
                      {thunderbirdSyncSources.length > 0 ? (
                        <div className="activity-list" style={{ marginTop: "12px" }}>
                          {thunderbirdSyncSources.map((source) => (
                            <div key={source.id} className="activity-row">
                              <div>
                                <strong>{source.mailbox.displayName}</strong>
                                <div className="muted">
                                  {source.mailbox.emailAddress} · {source.thunderbirdAccountName}
                                </div>
                              </div>
                              <span className="meta-pill">
                                {source.lastSyncedAt ? `Synced ${formatShortDate(source.lastSyncedAt)}` : "Pending"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-inline" style={{ marginTop: "12px" }}>
                          No Thunderbird workbench sources connected yet.
                        </div>
                      )}
                    </details>
                  </div>
                </>
              ) : (
                <>
                  <div className="stack-card">
                    <div className="card-heading">
                      <div>
                        <div className="eyebrow">Thunderbird</div>
                        <h3 className="panel-title">Accounts and folders</h3>
                      </div>
                      <div className={`status-pill ${thunderbirdStatus?.available ? "active" : "warning"}`}>
                        {thunderbirdStatus?.available ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                        {thunderbirdStatus?.available ? "Online" : "Offline"}
                      </div>
                    </div>

                    {thunderbirdAccounts.length > 0 ? (
                      <div className="selector-stack">
                        {thunderbirdAccounts.map((account) => (
                          <button
                            key={account.id}
                            className={`selector-button ${account.id === selectedThunderbirdAccountId ? "selected" : ""}`}
                            onClick={() => setSelectedThunderbirdAccountId(account.id)}
                          >
                            <div>
                              <strong>{account.name}</strong>
                              <div className="muted">{account.identities[0]?.email ?? "No default identity"}</div>
                            </div>
                            <span className="mailbox-pill">{account.type}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-inline">
                        {thunderbirdStatus?.available ? "No Thunderbird account detected." : "Install the Thunderbird MCP extension and restart Thunderbird."}
                      </div>
                    )}

                    {thunderbirdFolders.length > 0 ? (
                      <div className="chip-row">
                        {thunderbirdFolders.map((folder) => (
                          <button
                            key={folder.path}
                            className={`chip-button ${folder.path === selectedThunderbirdFolderPath ? "selected" : ""}`}
                            onClick={() => setSelectedThunderbirdFolderPath(folder.path)}
                          >
                            {folder.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="stack-card">
                    <div className="card-heading">
                      <div>
                        <div className="eyebrow">Messages</div>
                        <h3 className="panel-title">{liveHeaderName}</h3>
                      </div>
                      <span className="meta-pill">{thunderbirdMessages.length} loaded</span>
                    </div>

                    <div className="thread-items">
                      {thunderbirdMessages.length > 0 ? (
                        thunderbirdMessages.map((message) => (
                          <button
                            key={`${message.folderPath}:${message.id}`}
                            className={`thread-button ${message.id === selectedThunderbirdMessageId ? "selected" : ""}`}
                            onClick={() => {
                              setSelectedThunderbirdFolderPath(message.folderPath);
                              setSelectedThunderbirdMessageId(message.id);
                            }}
                          >
                            <div className="list-item">
                              <div className="list-item-top">
                                <strong>{message.subject || "(no subject)"}</strong>
                                <ChevronRight size={16} />
                              </div>
                              <p className="thread-preview">{message.author}</p>
                              <div className="thread-row-meta">
                                <span className="meta-pill">{message.folder}</span>
                                <span className="meta-pill">{formatDate(message.date)}</span>
                              </div>
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="empty-inline">
                          {thunderbirdStatus?.available ? "No live messages loaded yet." : "Thunderbird bridge is offline."}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </section>

            <section className="detail-pane">
              {sourceMode === "archive" ? (
                selectedThread ? (
                  <>
                    <div className="detail-card hero-card">
                      <div className="detail-header">
                        <div>
                          <div className="eyebrow">Conversation</div>
                          <h3 className="detail-title">{selectedThread.subject}</h3>
                        </div>
                        <div className={`status-pill ${replyTone(selectedThread.replyState)}`}>{replyLabel(selectedThread.replyState)}</div>
                      </div>

                      <div className="hero-metrics">
                        <div className="hero-metric">
                          <span className="summary-label">Reply due</span>
                          <strong>{formatDate(selectedThread.replyState?.replyDueAt)}</strong>
                        </div>
                        <div className="hero-metric">
                          <span className="summary-label">Mailbox</span>
                          <strong>{selectedThread.mailbox.displayName}</strong>
                        </div>
                        <div className="hero-metric">
                          <span className="summary-label">Confidence</span>
                          <strong>
                            {selectedThread.replyState ? `${Math.round(selectedThread.replyState.confidence * 100)}%` : "N/A"}
                          </strong>
                        </div>
                      </div>

                      <p className="workspace-copy">
                        {selectedThread.replyState?.reason ?? "Reply state has not been computed for this thread yet."}
                      </p>
                    </div>

                    <div className="detail-grid">
                      <div className="detail-card">
                        <div className="card-heading">
                          <div>
                            <div className="eyebrow">People + company</div>
                            <h3 className="panel-title">Participants</h3>
                          </div>
                          <Users size={18} />
                        </div>
                        <div className="pill-wrap">
                          {selectedThread.people.map((person) => (
                            <span key={person.id} className="person-chip">
                              <strong>{person.displayName ?? person.emailAddress}</strong>
                              <span>{person.organization?.name ?? person.emailAddress}</span>
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="detail-card">
                        <div className="card-heading">
                          <div>
                            <div className="eyebrow">Follow-ups</div>
                            <h3 className="panel-title">Pending reminders</h3>
                          </div>
                          <Clock3 size={18} />
                        </div>
                        {selectedThread.followUpTasks.length > 0 ? (
                          <div className="activity-list">
                            {selectedThread.followUpTasks.map((task) => (
                              <div key={task.id} className="activity-row">
                                <div>
                                  <strong>{task.title}</strong>
                                  <div className="muted">{task.note ?? "Auto-created from thread state."}</div>
                                </div>
                                <span className="meta-pill">{formatShortDate(task.dueAt)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="empty-inline">No pending reminder for this thread.</div>
                        )}
                      </div>

                      <div className="detail-card">
                        <div className="card-heading">
                          <div>
                            <div className="eyebrow">Accounts</div>
                            <h3 className="panel-title">By organization</h3>
                          </div>
                          <Building2 size={18} />
                        </div>
                        {(workbench?.byOrganization.length ?? 0) > 0 ? (
                          <div className="activity-list">
                            {workbench?.byOrganization.slice(0, 4).map((organization) => (
                              <div key={organization.id} className="activity-row">
                                <div>
                                  <strong>{organization.name}</strong>
                                  <div className="muted">{organization.primaryDomain ?? organization.kind.toLowerCase()}</div>
                                </div>
                                <span className="meta-pill">{organization.needsReply} open</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="empty-inline">Organizations will appear here after more threads are enriched.</div>
                        )}
                      </div>
                    </div>

                    <div className="detail-card">
                      <div className="card-heading">
                        <div>
                          <div className="eyebrow">Thread history</div>
                          <h3 className="panel-title">Messages</h3>
                        </div>
                        <FileText size={18} />
                      </div>

                      <div className="message-stack">
                        {selectedThread.messages.map((message) => (
                          <article key={message.id} className="message-card refined">
                            <div className="message-headline">
                              <strong>{message.fromName ?? message.fromAddress ?? "Unknown sender"}</strong>
                              <span className="meta-pill">{formatDate(message.receivedAt)}</span>
                            </div>
                            <div className="thread-row-meta">
                              <span className="muted">{message.fromAddress ?? "No sender address"}</span>
                              <div className="thread-row-meta">
                                {message.category ? <span className="mailbox-pill">{categoryLabel(message.category)}</span> : null}
                                <span className="meta-pill">{message.importance ?? "normal"}</span>
                              </div>
                            </div>
                            <p className="message-body">{message.bodyText || message.bodyPreview || "(empty message)"}</p>
                          </article>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="detail-empty">
                    <Inbox size={28} />
                    <h3>Select a conversation</h3>
                    <p>The reading pane stays focused on one thread, with people, reply state, and follow-up context inline.</p>
                  </div>
                )
              ) : selectedThunderbirdMessage ? (
                <>
                  <div className="detail-card hero-card">
                    <div className="detail-header">
                      <div>
                        <div className="eyebrow">Live message</div>
                        <h3 className="detail-title">{selectedThunderbirdMessage.subject || "(no subject)"}</h3>
                      </div>
                      <div className="mailbox-pill">{selectedThunderbirdMessage.folder}</div>
                    </div>
                    <p className="workspace-copy">{selectedThunderbirdMessage.author}</p>
                  </div>

                  <div className="detail-card">
                    <article className="message-card refined">
                      <div className="message-headline">
                        <strong>{selectedThunderbirdMessage.author}</strong>
                        <span className="meta-pill">{formatDate(selectedThunderbirdMessage.date)}</span>
                      </div>
                      <div className="thread-row-meta">
                        <span className="muted">{selectedThunderbirdMessage.recipients}</span>
                        <span className="mailbox-pill">{selectedThunderbirdMessage.read ? "read" : "unread"}</span>
                      </div>
                      <p className="message-body">{selectedThunderbirdMessage.body || "(empty message)"}</p>
                    </article>
                  </div>
                </>
              ) : (
                <div className="detail-empty">
                  <PlugZap size={28} />
                  <h3>No live message selected</h3>
                  <p>Pick a Thunderbird message from the list to inspect it here.</p>
                </div>
              )}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
