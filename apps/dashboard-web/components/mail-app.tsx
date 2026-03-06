"use client";

import {
  Archive,
  CheckCircle2,
  ChevronRight,
  Flag,
  FolderSync,
  Inbox,
  MailPlus,
  PlugZap,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  Upload
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
  type ThunderbirdStatus
} from "../lib/api";

type SourceMode = "thunderbird" | "archive";

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

function statusClass(status: AccountSummary["status"]) {
  return status === "ACTIVE" ? "active" : "warning";
}

export function MailApp() {
  const [sourceMode, setSourceMode] = useState<SourceMode>("thunderbird");
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
      setImports([]);
      setSelectedThreadId(null);
      setSelectedThread(null);
      return;
    }

    void refreshThreads(selectedMailboxId);
    void refreshImports(selectedMailboxId, selectedAccountId ?? undefined);
  }, [selectedMailboxId]);

  useEffect(() => {
    if (!selectedMailboxId && selectedAccountId) {
      void refreshImports(undefined, selectedAccountId);
    }
  }, [selectedAccountId, selectedMailboxId]);

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
      setSelectedThreadId((current) => {
        const retained = data.threads.find((thread) => thread.id === current)?.id;
        return retained ?? data.threads[0]?.id ?? null;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load threads.");
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
        await refreshImports(selectedMailboxId ?? undefined, selectedAccountId ?? undefined);
        if (selectedMailboxId) {
          await refreshThreads(selectedMailboxId);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Archive import failed.");
      }
    });
  }

  const archiveThreads = useMemo(() => {
    const normalizedQuery = deferredSearch.trim().toLowerCase();

    if (!normalizedQuery) {
      return threads;
    }

    return threads.filter((thread) => {
      const participants = thread.participants
        .map((participant) => `${participant.name} ${participant.address}`)
        .join(" ")
        .toLowerCase();

      return (
        thread.subject.toLowerCase().includes(normalizedQuery) ||
        thread.latestMessage?.bodyPreview.toLowerCase().includes(normalizedQuery) ||
        participants.includes(normalizedQuery)
      );
    });
  }, [deferredSearch, threads]);

  const liveHeaderName =
    thunderbirdFolders.find((folder) => folder.path === selectedThunderbirdFolderPath)?.name ??
    selectedThunderbirdAccount?.name ??
    "Thunderbird";
  const liveMessageAttachments = selectedThunderbirdMessage?.attachments ?? [];

  return (
    <main className="mail-shell">
      <div className="mail-frame">
        <aside className="panel sidebar">
          <div className="brand">
            <div className="brand-mark">
              <Sparkles size={22} />
            </div>
            <div>
              <div className="eyebrow">Phase 1</div>
              <h1 className="title">Smart Mail</h1>
            </div>
          </div>

          <p className="copy">
            Thunderbird is now the preferred live mailbox provider. Archive import and Microsoft OAuth stay available as fallback ingestion paths.
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
              Imported Mail
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
                      Live folders and messages come from your local Thunderbird profile, not directly from Microsoft Graph.
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
                            <div className="muted">
                              {account.identities[0]?.email ?? "No identity detected"}
                            </div>
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
                    {thunderbirdStatus?.extensionXpiPath ? (
                      <div className="muted">{thunderbirdStatus.extensionXpiPath}</div>
                    ) : null}
                    {thunderbirdStatus?.profilePaths?.[0] ? (
                      <div className="muted">{thunderbirdStatus.profilePaths[0]}</div>
                    ) : null}
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
                    <div>Use `.eml` or `.olm` import to backfill history, or connect Microsoft if tenant approval becomes available later.</div>
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
                  Import `.olm` for Outlook history or `.eml` for targeted recovery. If a mailbox is selected above, the import lands there.
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
              <div className="eyebrow">{sourceMode === "thunderbird" ? "Live stream" : "Imported stream"}</div>
              <h2 className="title" style={{ fontSize: "1.2rem" }}>
                {sourceMode === "thunderbird"
                  ? liveHeaderName
                  : selectedAccount?.mailboxes.find((mailbox) => mailbox.id === selectedMailboxId)?.displayName ??
                    "Choose a mailbox"}
              </h2>
            </div>
            <div className="status-pill active">
              <FolderSync size={14} />
              {sourceMode === "thunderbird" ? thunderbirdMessages.length : archiveThreads.length} loaded
            </div>
          </div>

          <input
            className="search"
            placeholder={
              sourceMode === "thunderbird"
                ? "Search Thunderbird subject, sender, or recipient"
                : "Search subject, preview, or people"
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
            ) : selectedMailboxId && archiveThreads.length > 0 ? (
              archiveThreads.map((thread) => (
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
                        {thread.latestMessage?.fromName ?? thread.latestMessage?.fromAddress ?? "Unknown sender"}
                      </span>
                      <span className="meta-pill">{formatDate(thread.lastMessageAt)}</span>
                    </div>
                    <div className="thread-row-meta">
                      <span className="mailbox-pill">{thread.mailbox.kind.toLowerCase()}</span>
                      {thread.unreadCount > 0 ? <span className="status-pill warning">{thread.unreadCount} unread</span> : null}
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="empty-state">
                <Archive size={24} />
                <div>{selectedMailboxId ? "No imported threads yet." : "Select an imported mailbox to browse threads."}</div>
                <div>Use archive import to backfill history, or return to Thunderbird Live for your current mailbox view.</div>
              </div>
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
                  <div className="eyebrow">Imported Conversation</div>
                  <h2 className="title">{selectedThread.subject}</h2>
                </div>
                <div className="status-pill active">
                  <Archive size={14} />
                  {selectedThread.mailbox.displayName}
                </div>
              </div>

              <div className="copy">
                {selectedThread.participants.map((participant) => participant.name || participant.address).join(", ")}
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
                      <div className="mailbox-pill">{message.importance ?? "normal"}</div>
                    </div>
                    <p className="message-body">{message.bodyText || message.bodyPreview || "(empty message)"}</p>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Archive size={26} />
              <div>No imported thread selected.</div>
              <div>Choose a synced conversation from the middle column to inspect the full message stack.</div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
