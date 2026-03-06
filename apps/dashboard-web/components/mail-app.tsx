"use client";

import {
  CheckCircle2,
  ChevronRight,
  Flag,
  FolderSync,
  Inbox,
  MailPlus,
  RefreshCcw,
  ShieldAlert,
  Sparkles
} from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addSharedMailbox,
  fetchAccounts,
  fetchThread,
  fetchThreads,
  getMicrosoftConnectUrl,
  queueSync,
  type AccountSummary,
  type ThreadDetail,
  type ThreadSummary
} from "../lib/api";

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
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<ThreadDetail | null>(null);
  const [search, setSearch] = useState("");
  const [sharedMailboxEmail, setSharedMailboxEmail] = useState("");
  const [sharedMailboxName, setSharedMailboxName] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSyncPending, startSyncTransition] = useTransition();
  const [isMailboxPending, startMailboxTransition] = useTransition();

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );
  const deferredSearch = useDeferredValue(search);

  const visibleThreads = useMemo(() => {
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
    void refreshAccounts();
  }, []);

  useEffect(() => {
    if (!selectedMailboxId) {
      setThreads([]);
      setSelectedThreadId(null);
      setSelectedThread(null);
      return;
    }

    void refreshThreads(selectedMailboxId);
  }, [selectedMailboxId]);

  useEffect(() => {
    if (!selectedThreadId) {
      setSelectedThread(null);
      return;
    }

    void loadThread(selectedThreadId);
  }, [selectedThreadId]);

  async function refreshAccounts() {
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
      toast.error(error instanceof Error ? error.message : "Failed to load accounts.");
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

  async function handleManualSync() {
    if (!selectedAccount) {
      toast.error("Connect an account before syncing.");
      return;
    }

    startSyncTransition(async () => {
      try {
        const result = await queueSync(selectedAccount.id);
        toast.success(`Queued ${result.queued} mailbox sync${result.queued === 1 ? "" : "s"}.`);
        await refreshAccounts();
        if (selectedMailboxId) {
          await refreshThreads(selectedMailboxId);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to queue sync.");
      }
    });
  }

  async function handleAddSharedMailbox(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedAccount) {
      toast.error("Connect a Microsoft account first.");
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
        await refreshAccounts();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to add shared mailbox.");
      }
    });
  }

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
            Outlook sync, shared mailbox intake, and a local-first thread workspace built for the MVP.
          </p>

          <div className="actions">
            <button className="button primary" onClick={() => (window.location.href = getMicrosoftConnectUrl())}>
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
                <div className="eyebrow">Accounts</div>
                <h2 className="title" style={{ fontSize: "1.1rem" }}>
                  Mail sources
                </h2>
              </div>
              <button className="button secondary" disabled={loading} onClick={() => void refreshAccounts()}>
                <FolderSync size={16} />
                Refresh
              </button>
            </div>

            {accounts.length === 0 ? (
              <div className="empty-state">
                <Inbox size={24} />
                <div>No mailbox connected yet.</div>
                <div>Use Microsoft OAuth to seed the primary inbox and start the worker loop.</div>
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
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      setSelectedAccountId(account.id);
                      setSelectedMailboxId(account.mailboxes[0]?.id ?? null);
                    }
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
                          <div className="mailbox-pill">{mailbox.kind.toLowerCase()}</div>
                          <div className="muted">{mailbox.emailAddress}</div>
                          <div className="thread-row-meta">
                            <span className="meta-pill">{mailbox._count.threads} threads</span>
                            <span className="meta-pill">{formatDate(mailbox.lastSyncedAt)}</span>
                          </div>
                          {mailbox.lastSyncError ? <div className="muted">{mailbox.lastSyncError}</div> : null}
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

          <div className="spacer" />
        </aside>

        <section className="panel thread-list">
          <div className="thread-header">
            <div>
              <div className="eyebrow">Mailbox stream</div>
              <h2 className="title" style={{ fontSize: "1.2rem" }}>
                {selectedAccount?.mailboxes.find((mailbox) => mailbox.id === selectedMailboxId)?.displayName ??
                  "Choose a mailbox"}
              </h2>
            </div>
            <div className="status-pill active">
              <FolderSync size={14} />
              {visibleThreads.length} loaded
            </div>
          </div>

          <input
            className="search"
            placeholder="Search subject, preview, or people"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <div className="thread-items">
            {selectedMailboxId && visibleThreads.length > 0 ? (
              visibleThreads.map((thread) => (
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
                <Inbox size={24} />
                <div>{selectedMailboxId ? "No synced threads yet." : "Select a mailbox to browse threads."}</div>
                <div>Run a sync after OAuth completes if the worker has not processed the queue yet.</div>
              </div>
            )}
          </div>
        </section>

        <section className="panel thread-view">
          {selectedThread ? (
            <>
              <div className="thread-view-header">
                <div>
                  <div className="eyebrow">Conversation</div>
                  <h2 className="title">{selectedThread.subject}</h2>
                </div>
                <div className="status-pill active">
                  <Inbox size={14} />
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
                    {message.webLink ? (
                      <a href={message.webLink} target="_blank" rel="noreferrer" className="status-pill active">
                        Open in Outlook
                      </a>
                    ) : null}
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Inbox size={26} />
              <div>No thread selected.</div>
              <div>Choose a synced conversation from the middle column to inspect the full message stack.</div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
