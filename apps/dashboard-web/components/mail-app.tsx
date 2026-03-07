"use client";

import {
  Archive,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Flag,
  FolderSync,
  Inbox,
  LayoutGrid,
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
  fetchThunderbirdAccounts,
  fetchThunderbirdFolders,
  fetchThunderbirdMessage,
  fetchThunderbirdRecentMessages,
  fetchThunderbirdStatus,
  fetchWorkbench,
  getMicrosoftConnectUrl,
  queueSync,
  searchThunderbirdMessages,
  uploadArchive,
  type AccountSummary,
  type ImportJobSummary,
  type ThreadDetail,
  type ThreadSummary,
  type ThunderbirdAccount,
  type ThunderbirdFolder,
  type ThunderbirdMessageDetail,
  type ThunderbirdMessageSummary,
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

function replyTone(state: ThreadSummary["replyState"]) {
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

function replyLabel(state: ThreadSummary["replyState"]) {
  if (!state) {
    return "Unclassified";
  }

  switch (state.status) {
    case "NEEDS_REPLY":
      return state.isOverdue ? "Overdue reply" : "Needs reply";
    case "WAITING_ON_THEM":
      return "Waiting on them";
    case "FOLLOW_UP_LATER":
      return "Follow up later";
    case "CLOSED_LOOP":
    default:
      return "Closed loop";
  }
}

function categoryLabel(category: ThreadSummary["latestCategory"]) {
  return category?.label.toLowerCase().replace(/_/g, " ") ?? "uncategorized";
}

export function MailApp() {
  const [sourceMode, setSourceMode] = useState<SourceMode>("thunderbird");
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
  const [loading, setLoading] = useState(true);
  const [isSyncPending, startSyncTransition] = useTransition();
  const [isMailboxPending, startMailboxTransition] = useTransition();
  const [isImportPending, startImportTransition] = useTransition();

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
  const deferredSearch = useDeferredValue(search);

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

        startTransition(() => {
          const nextAccount = data.accounts[0] ?? null;
          setSelectedThunderbirdAccountId(nextAccount?.id ?? null);
          if (nextAccount) {
            setSourceMode("thunderbird");
          } else if (accounts.length > 0) {
            setSourceMode("archive");
          }
        });
      } else if (accounts.length > 0) {
        setSourceMode("archive");
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

        if (!thunderbirdStatus?.available && nextAccount) {
          setSourceMode("archive");
        }
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

    const nextThreads =
      archiveSurface === "needsReply"
        ? filteredWorkbenchNeedsReply
        : archiveSurface === "waitingOnThem"
          ? filteredWorkbenchWaiting
          : allArchiveThreads;

    setSelectedThreadId((current) => {
      const retained = nextThreads.find((thread) => thread.id === current)?.id;
      return retained ?? nextThreads[0]?.id ?? null;
    });
  }, [allArchiveThreads, archiveSurface, filteredFollowUps, filteredWorkbenchNeedsReply, filteredWorkbenchWaiting, sourceMode]);

  const liveHeaderName =
    thunderbirdFolders.find((folder) => folder.path === selectedThunderbirdFolderPath)?.name ??
    selectedThunderbirdAccount?.name ??
    "Thunderbird";
  const liveMessageAttachments = selectedThunderbirdMessage?.attachments ?? [];
  const archiveListTitle =
    archiveSurface === "needsReply"
      ? "Needs Reply"
      : archiveSurface === "waitingOnThem"
        ? "Waiting on Client"
        : archiveSurface === "followUpToday"
          ? "Follow Up Today"
          : "All Threads";

  return (
    <main className="mail-shell">
      <div className="mail-frame">
        <aside className="panel sidebar">
          <div className="brand">
            <div className="brand-mark">
              <Sparkles size={22} />
            </div>
            <div>
              <div className="eyebrow">Phase 2</div>
              <h1 className="title">Smart Mail</h1>
            </div>
          </div>

          <p className="copy">
            Intelligence is now layered on top of stored mail: people, organizations, reply obligations, and follow-up queues.
          </p>

          <div className="source-tabs">
            <button
              className={`button ${sourceMode === "thunderbird" ? "primary" : "secondary"}`}
              onClick={() => setSourceMode("thunderbird")}
            >
              <PlugZap size={16} />
              Thunderbird Live
            </button>
            <button
              className={`button ${sourceMode === "archive" ? "primary" : "secondary"}`}
              onClick={() => setSourceMode("archive")}
            >
              <Archive size={16} />
              Intelligence Hub
            </button>
          </div>

          {sourceMode === "thunderbird" ? (
            <>
              <div className="account-card">
                <div className="thread-header">
                  <div>
                    <div className="eyebrow">Live Source</div>
                    <h2 className="title" style={{ fontSize: "1.1rem" }}>
                      Thunderbird
                    </h2>
                  </div>
                  <button className="button secondary" onClick={() => void refreshThunderbirdStatus()}>
                    <RefreshCcw size={16} />
                    Refresh
                  </button>
                </div>

                <div className={`status-pill ${thunderbirdStatus?.available ? "active" : "warning"}`}>
                  {thunderbirdStatus?.available ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                  {thunderbirdStatus?.available ? "Bridge online" : "Bridge offline"}
                </div>

                <div className="muted">{thunderbirdStatus?.bridgeUrl ?? "http://127.0.0.1:8765"}</div>

                {thunderbirdStatus?.available ? (
                  <>
                    <div className="copy">
                      Live folders and messages come from your local Thunderbird profile while the archive side powers Phase 2 intelligence.
                    </div>
                    <div className="mailbox-list">
                      {thunderbirdAccounts.map((account) => (
                        <button
                          key={account.id}
                          className={`mailbox-button ${account.id === selectedThunderbirdAccountId ? "selected" : ""}`}
                          onClick={() => setSelectedThunderbirdAccountId(account.id)}
                        >
                          <div className="mailbox-row">
                            <div className="mailbox-name">
                              <Inbox size={16} />
                              <strong>{account.name}</strong>
                            </div>
                            <div className="mailbox-pill">{account.type}</div>
                            <div className="muted">{account.identities[0]?.email ?? "No identity detected"}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <PlugZap size={24} />
                    <div>Thunderbird MCP is not reachable yet.</div>
                    <div>{thunderbirdStatus?.error ?? "Install the extension XPI in Thunderbird and restart the app."}</div>
                  </div>
                )}
              </div>

              <div className="account-card">
                <div className="thread-header">
                  <div>
                    <div className="eyebrow">Folders</div>
                    <h2 className="title" style={{ fontSize: "1.1rem" }}>
                      {selectedThunderbirdAccount?.name ?? "No account selected"}
                    </h2>
                  </div>
                  <div className="status-pill active">
                    <FolderSync size={14} />
                    {thunderbirdFolders.length} folders
                  </div>
                </div>
                <div className="mailbox-list">
                  {thunderbirdFolders.map((folder) => (
                    <button
                      key={folder.path}
                      className={`mailbox-button ${folder.path === selectedThunderbirdFolderPath ? "selected" : ""}`}
                      onClick={() => setSelectedThunderbirdFolderPath(folder.path)}
                    >
                      <div className="mailbox-row">
                        <div className="mailbox-name" style={{ paddingLeft: `${folder.depth * 12}px` }}>
                          <FolderSync size={16} />
                          <strong>{folder.name}</strong>
                        </div>
                        <div className="thread-row-meta">
                          <span className="mailbox-pill">{folder.type}</span>
                          <span className="meta-pill">{folder.unreadMessages} unread</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="actions">
                <button
                  className="button primary"
                  onClick={() => (window.location.href = getMicrosoftConnectUrl(`${window.location.origin}/mail`))}
                >
                  <MailPlus size={16} />
                  Connect Microsoft
                </button>
                <button className="button secondary" disabled={isSyncPending} onClick={() => void handleManualSync()}>
                  <RefreshCcw size={16} />
                  Sync now
                </button>
              </div>

              <div className="metric-grid">
                <div className="metric-card">
                  <div className="eyebrow">Needs Reply</div>
                  <strong>{workbench?.summary.needsReply ?? 0}</strong>
                  <span className="muted">{workbench?.summary.overdue ?? 0} overdue</span>
                </div>
                <div className="metric-card">
                  <div className="eyebrow">Waiting</div>
                  <strong>{workbench?.summary.waitingOnThem ?? 0}</strong>
                  <span className="muted">reply already sent</span>
                </div>
                <div className="metric-card">
                  <div className="eyebrow">Follow Up Today</div>
                  <strong>{workbench?.summary.followUpToday ?? 0}</strong>
                  <span className="muted">auto reminders</span>
                </div>
              </div>

              <div className="account-card">
                <div className="thread-header">
                  <div>
                    <div className="eyebrow">Imported Accounts</div>
                    <h2 className="title" style={{ fontSize: "1.1rem" }}>
                      Mail sources
                    </h2>
                  </div>
                  <button className="button secondary" disabled={loading} onClick={() => void refreshArchiveAccounts()}>
                    <FolderSync size={16} />
                    Refresh
                  </button>
                </div>

                {accounts.length === 0 ? (
                  <div className="empty-state">
                    <Archive size={24} />
                    <div>No imported mailbox connected yet.</div>
                    <div>Use `.eml` or `.olm` import to backfill history, or connect Microsoft when OAuth is available.</div>
                  </div>
                ) : (
                  accounts.map((account) => (
                    <div
                      key={account.id}
                      className={`account-card ${account.id === selectedAccountId ? "selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedAccountId(account.id);
                        setSelectedMailboxId(account.mailboxes[0]?.id ?? null);
                      }}
                    >
                      <div className="account-title">
                        <CheckCircle2 size={16} />
                        <strong>{account.displayName ?? account.email}</strong>
                      </div>
                      <div className={`status-pill ${statusClass(account.status)}`}>
                        {account.status === "ACTIVE" ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                        {account.status === "ACTIVE" ? "Active" : "Needs attention"}
                      </div>
                      <div className="mailbox-pill">{account.provider === "MICROSOFT" ? "oauth" : "archive"}</div>
                      <div className="muted">{account.email}</div>
                      <div className="mailbox-list">
                        {account.mailboxes.map((mailbox) => (
                          <button
                            key={mailbox.id}
                            className={`mailbox-button ${mailbox.id === selectedMailboxId ? "selected" : ""}`}
                            onClick={() => {
                              setSelectedAccountId(account.id);
                              setSelectedMailboxId(mailbox.id);
                            }}
                          >
                            <div className="mailbox-row">
                              <div className="mailbox-name">
                                {mailbox.kind === "PRIMARY" ? <Inbox size={16} /> : <Flag size={16} />}
                                <strong>{mailbox.displayName}</strong>
                              </div>
                              <div className="thread-row-meta">
                                <span className="mailbox-pill">{mailbox.kind.toLowerCase()}</span>
                                <span className="meta-pill">{mailbox._count.threads} threads</span>
                              </div>
                              <div className="muted">{mailbox.emailAddress}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="account-card">
                <div className="thread-header">
                  <div>
                    <div className="eyebrow">By Client / Account</div>
                    <h2 className="title" style={{ fontSize: "1.1rem" }}>
                      Organizations
                    </h2>
                  </div>
                  <div className="status-pill active">
                    <Building2 size={14} />
                    {workbench?.byOrganization.length ?? 0} active
                  </div>
                </div>

                {(workbench?.byOrganization.length ?? 0) > 0 ? (
                  <div className="mailbox-list">
                    {workbench?.byOrganization.map((organization) => (
                      <div key={organization.id} className="mailbox-row">
                        <div className="mailbox-name">
                          <Building2 size={16} />
                          <strong>{organization.name}</strong>
                        </div>
                        <div className="thread-row-meta">
                          {organization.needsReply > 0 ? (
                            <span className="status-pill warning">{organization.needsReply} needs reply</span>
                          ) : null}
                          {organization.followUps > 0 ? <span className="meta-pill">{organization.followUps} follow-ups</span> : null}
                        </div>
                        <div className="muted">{organization.primaryDomain ?? organization.kind.toLowerCase()}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state compact">
                    <Building2 size={20} />
                    <div>Organizations will appear here as intelligence is derived from stored mail.</div>
                  </div>
                )}
              </div>

              <form className="form" onSubmit={(event) => void handleAddSharedMailbox(event)}>
                <div className="eyebrow">Shared mailbox</div>
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
                  Add shared mailbox
                </button>
              </form>

              <form className="form" onSubmit={(event) => void handleArchiveImport(event)}>
                <div className="eyebrow">Archive Import</div>
                <div className="copy">
                  Import `.olm` for history or `.eml` for targeted recovery. New mail is enriched into people, organization, and reply-state records on ingest.
                </div>
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
                  Import archive
                </button>
              </form>
            </>
          )}

          <div className="spacer" />
        </aside>

        <section className="panel thread-list">
          <div className="thread-header">
            <div>
              <div className="eyebrow">{sourceMode === "thunderbird" ? "Live stream" : "Action queue"}</div>
              <h2 className="title" style={{ fontSize: "1.2rem" }}>
                {sourceMode === "thunderbird" ? liveHeaderName : archiveListTitle}
              </h2>
            </div>
            <div className="status-pill active">
              {sourceMode === "thunderbird" ? <PlugZap size={14} /> : <LayoutGrid size={14} />}
              {sourceMode === "thunderbird"
                ? `${thunderbirdMessages.length} loaded`
                : `${archiveSurface === "followUpToday" ? filteredFollowUps.length : archiveSurface === "needsReply" ? filteredWorkbenchNeedsReply.length : archiveSurface === "waitingOnThem" ? filteredWorkbenchWaiting.length : allArchiveThreads.length} items`}
            </div>
          </div>

          {sourceMode === "archive" ? (
            <div className="surface-tabs">
              <button
                className={`button ${archiveSurface === "needsReply" ? "primary" : "secondary"}`}
                onClick={() => setArchiveSurface("needsReply")}
              >
                <Inbox size={16} />
                Needs Reply
              </button>
              <button
                className={`button ${archiveSurface === "waitingOnThem" ? "primary" : "secondary"}`}
                onClick={() => setArchiveSurface("waitingOnThem")}
              >
                <SendHorizontal size={16} />
                Waiting on Client
              </button>
              <button
                className={`button ${archiveSurface === "followUpToday" ? "primary" : "secondary"}`}
                onClick={() => setArchiveSurface("followUpToday")}
              >
                <Clock3 size={16} />
                Follow Up Today
              </button>
              <button
                className={`button ${archiveSurface === "allThreads" ? "primary" : "secondary"}`}
                onClick={() => setArchiveSurface("allThreads")}
              >
                <LayoutGrid size={16} />
                All Threads
              </button>
            </div>
          ) : null}

          <input
            className="search"
            placeholder={
              sourceMode === "thunderbird"
                ? "Search Thunderbird subject, sender, or recipient"
                : "Search subject, people, company, or follow-up"
            }
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <div className="thread-items">
            {sourceMode === "thunderbird" ? (
              thunderbirdStatus?.available && thunderbirdMessages.length > 0 ? (
                thunderbirdMessages.map((message) => (
                  <button
                    key={`${message.folderPath}:${message.id}`}
                    className={`thread-button ${message.id === selectedThunderbirdMessageId ? "selected" : ""}`}
                    onClick={() => {
                      setSelectedThunderbirdFolderPath(message.folderPath);
                      setSelectedThunderbirdMessageId(message.id);
                    }}
                  >
                    <div className="thread-row">
                      <div className="thread-row-top">
                        <h3 className="thread-subject">{message.subject || "(no subject)"}</h3>
                        <ChevronRight size={16} />
                      </div>
                      <p className="thread-preview">{message.author}</p>
                      <div className="thread-row-meta">
                        <span className="meta-pill">{message.folder}</span>
                        <span className="meta-pill">{formatDate(message.date)}</span>
                      </div>
                      <div className="thread-row-meta">
                        {message.flagged ? <span className="status-pill warning">flagged</span> : null}
                        {!message.read ? <span className="status-pill warning">unread</span> : null}
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  <Inbox size={24} />
                  <div>{thunderbirdStatus?.available ? "No live messages loaded yet." : "Thunderbird bridge is offline."}</div>
                  <div>
                    {thunderbirdStatus?.available
                      ? "Select a Thunderbird folder or sync it in Thunderbird first."
                      : "Install the Thunderbird MCP extension XPI, restart Thunderbird, and refresh this page."}
                  </div>
                </div>
              )
            ) : archiveSurface === "followUpToday" ? (
              filteredFollowUps.length > 0 ? (
                filteredFollowUps.map((task) => (
                  <button
                    key={task.id}
                    className={`thread-button ${task.thread.id === selectedThreadId ? "selected" : ""}`}
                    onClick={() => setSelectedThreadId(task.thread.id)}
                  >
                    <div className="thread-row">
                      <div className="thread-row-top">
                        <h3 className="thread-subject">{task.title}</h3>
                        <ChevronRight size={16} />
                      </div>
                      <p className="thread-preview">{task.note ?? task.thread.subject}</p>
                      <div className="thread-row-meta">
                        <span className="meta-pill">{task.organization?.name ?? task.contact?.displayName ?? "Thread follow-up"}</span>
                        <span className="status-pill warning">Due {formatShortDate(task.dueAt)}</span>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  <Clock3 size={24} />
                  <div>No follow-ups due today.</div>
                  <div>Auto-created reminders will appear here when you are waiting on someone and the follow-up window arrives.</div>
                </div>
              )
            ) : (
              (() => {
                const archiveItems =
                  archiveSurface === "needsReply"
                    ? filteredWorkbenchNeedsReply
                    : archiveSurface === "waitingOnThem"
                      ? filteredWorkbenchWaiting
                      : allArchiveThreads;

                if (!selectedMailboxId && archiveItems.length === 0) {
                  return (
                    <div className="empty-state">
                      <Archive size={24} />
                      <div>Select or import a mailbox to build the action queues.</div>
                      <div>The Phase 2 dashboard runs against stored messages and derived intelligence.</div>
                    </div>
                  );
                }

                if (archiveItems.length === 0) {
                  return (
                    <div className="empty-state">
                      <Inbox size={24} />
                      <div>No threads match this queue yet.</div>
                      <div>Try another surface, import more history, or wait for the next sync.</div>
                    </div>
                  );
                }

                return archiveItems.map((thread) => (
                  <button
                    key={thread.id}
                    className={`thread-button ${thread.id === selectedThreadId ? "selected" : ""}`}
                    onClick={() => setSelectedThreadId(thread.id)}
                  >
                    <div className="thread-row">
                      <div className="thread-row-top">
                        <h3 className="thread-subject">{thread.subject}</h3>
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
                        <span className="meta-pill">{formatDate(thread.lastMessageAt)}</span>
                      </div>
                      <div className="thread-row-meta">
                        <span className={`status-pill ${replyTone(thread.replyState)}`}>{replyLabel(thread.replyState)}</span>
                        {thread.latestCategory ? <span className="mailbox-pill">{categoryLabel(thread.latestCategory)}</span> : null}
                        {thread.replyState?.replyDueAt ? (
                          <span className="meta-pill">Due {formatShortDate(thread.replyState.replyDueAt)}</span>
                        ) : null}
                        {thread.replyState?.suggestedFollowUpAt ? (
                          <span className="meta-pill">Follow up {formatShortDate(thread.replyState.suggestedFollowUpAt)}</span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                ));
              })()
            )}
          </div>
        </section>

        <section className="panel thread-view">
          {sourceMode === "thunderbird" ? (
            selectedThunderbirdMessage ? (
              <>
                <div className="thread-view-header">
                  <div>
                    <div className="eyebrow">Live Message</div>
                    <h2 className="title">{selectedThunderbirdMessage.subject || "(no subject)"}</h2>
                  </div>
                  <div className="status-pill active">
                    <PlugZap size={14} />
                    {selectedThunderbirdMessage.folder}
                  </div>
                </div>
                <div className="copy">{selectedThunderbirdMessage.author}</div>
                <div className="message-stack">
                  <article className="message-card">
                    <div className="message-headline">
                      <strong>{selectedThunderbirdMessage.author}</strong>
                      <div className="meta-pill">{formatDate(selectedThunderbirdMessage.date)}</div>
                    </div>
                    <div className="message-meta">
                      <div className="muted">{selectedThunderbirdMessage.recipients}</div>
                      <div className="mailbox-pill">{selectedThunderbirdMessage.read ? "read" : "unread"}</div>
                    </div>
                    <p className="message-body">{selectedThunderbirdMessage.body || "(empty message)"}</p>
                    {liveMessageAttachments.length > 0 ? (
                      <div className="thread-row-meta">
                        {liveMessageAttachments.map((attachment) => (
                          <span key={`${attachment.name}-${attachment.size}`} className="meta-pill">
                            {attachment.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <PlugZap size={26} />
                <div>No live message selected.</div>
                <div>Choose a Thunderbird message from the middle column to inspect its full body.</div>
              </div>
            )
          ) : selectedThread ? (
            <>
              <div className="thread-view-header">
                <div>
                  <div className="eyebrow">Conversation Intelligence</div>
                  <h2 className="title">{selectedThread.subject}</h2>
                </div>
                <div className={`status-pill ${replyTone(selectedThread.replyState)}`}>
                  <Inbox size={14} />
                  {replyLabel(selectedThread.replyState)}
                </div>
              </div>

              <div className="insight-grid">
                <div className="insight-card">
                  <div className="eyebrow">Reply State</div>
                  <strong>{replyLabel(selectedThread.replyState)}</strong>
                  <div className="copy">{selectedThread.replyState?.reason ?? "No reply state computed yet."}</div>
                  {selectedThread.replyState?.replyDueAt ? (
                    <div className="meta-pill">Reply due {formatDate(selectedThread.replyState.replyDueAt)}</div>
                  ) : null}
                  {selectedThread.replyState?.suggestedFollowUpAt ? (
                    <div className="meta-pill">Follow up {formatDate(selectedThread.replyState.suggestedFollowUpAt)}</div>
                  ) : null}
                </div>

                <div className="insight-card">
                  <div className="eyebrow">People + Company</div>
                  <strong>{selectedThread.people.length} participants</strong>
                  <div className="pill-wrap">
                    {selectedThread.people.map((person) => (
                      <span key={person.id} className="meta-pill">
                        {person.displayName ?? person.emailAddress}
                        {person.organization ? ` · ${person.organization.name}` : ""}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="insight-card">
                  <div className="eyebrow">Follow-ups</div>
                  <strong>{selectedThread.followUpTasks.length}</strong>
                  <div className="pill-wrap">
                    {selectedThread.followUpTasks.length > 0 ? (
                      selectedThread.followUpTasks.map((task) => (
                        <span key={task.id} className="meta-pill">
                          {task.title} · {formatShortDate(task.dueAt)}
                        </span>
                      ))
                    ) : (
                      <span className="muted">No pending reminder for this thread.</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="message-stack">
                {selectedThread.messages.map((message) => (
                  <article key={message.id} className="message-card">
                    <div className="message-headline">
                      <strong>{message.fromName ?? message.fromAddress ?? "Unknown sender"}</strong>
                      <div className="meta-pill">{formatDate(message.receivedAt)}</div>
                    </div>
                    <div className="message-meta">
                      <div className="muted">{message.fromAddress ?? "No sender address"}</div>
                      <div className="thread-row-meta">
                        {message.category ? <span className="mailbox-pill">{categoryLabel(message.category)}</span> : null}
                        <span className="meta-pill">{message.importance ?? "normal"}</span>
                      </div>
                    </div>
                    <p className="message-body">{message.bodyText || message.bodyPreview || "(empty message)"}</p>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Archive size={26} />
              <div>No conversation selected.</div>
              <div>Choose a queue item from the middle column to inspect the thread, people, and follow-up state.</div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
