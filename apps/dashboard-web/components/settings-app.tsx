"use client";

import type { Route } from "next";
import {
  Bolt,
  BrainCircuit,
  CheckCircle2,
  Cloud,
  FolderCog,
  Globe,
  Keyboard,
  Layers3,
  RefreshCcw,
  ServerCog,
  Settings2,
  Sparkles,
  Waypoints
} from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  fetchAppleMailAccounts,
  fetchAppleMailFolders,
  fetchAccounts,
  fetchModelProviderCatalog,
  fetchSettings,
  updateAccountsSettings,
  updateModelsSettings,
  updateWorkflowsSettings,
  type AccountSummary,
  type AccountsSettings,
  type AppleMailAccount,
  type AppleMailFolder,
  type ModelProvider,
  type ModelProviderCatalog,
  type ModelsSettings,
  type SettingsPayload,
  type WorkflowsSettings
} from "../lib/api";
import { AppShell } from "./app-shell";

type SettingsSection = "models" | "accounts" | "workflows";

const liveSourceLabels: Record<AccountsSettings["preferredLiveSource"], string> = {
  APPLE_MAIL: "Apple Mail",
  MICROSOFT_GRAPH: "Microsoft Graph",
  OUTLOOK_MCP: "Outlook MCP",
  THUNDERBIRD: "Thunderbird"
};

const queueLabels: Record<WorkflowsSettings["replyQueueDefault"], string> = {
  needsReply: "Needs reply",
  waitingOnThem: "Waiting",
  allThreads: "All mail"
};

const categoryLabels: Record<ModelsSettings["enrichmentSource"]["category"], string> = {
  LOCAL_PROVIDER: "Local provider",
  CLOUD_API_TOKEN: "Cloud API token",
  COMPANION_ASSISTANT: "Companion assistant"
};

const categoryStatLabels: Record<ModelsSettings["enrichmentSource"]["category"], string> = {
  LOCAL_PROVIDER: "Local provider",
  CLOUD_API_TOKEN: "Cloud token",
  COMPANION_ASSISTANT: "Companion"
};

const categoryDescriptions: Record<ModelsSettings["enrichmentSource"]["category"], string> = {
  LOCAL_PROVIDER: "Run enrichment against LM Studio, Ollama, or another local OpenAI-compatible endpoint.",
  CLOUD_API_TOKEN: "Use a hosted provider with a direct API token for drafting, summarization, and enrichment.",
  COMPANION_ASSISTANT: "Reserved for a future companion integration that can sit on top of the same deterministic mailbox graph."
};

const desktopModelCategories = ["LOCAL_PROVIDER", "CLOUD_API_TOKEN"] as const satisfies ReadonlyArray<
  ModelsSettings["enrichmentSource"]["category"]
>;

const routingModes = [
  {
    id: "AUTO",
    label: "Auto"
  },
  {
    id: "EXPLICIT",
    label: "Explicit"
  }
] as const;

const sectionContent = {
  models: {
    title: "Models",
    eyebrow: "Provider routing",
    description:
      "Route enrichment on top of deterministic mailbox intelligence. Analytics remain structured and model-independent."
  },
  accounts: {
    title: "Accounts",
    eyebrow: "Mailbox routing",
    description:
      "Tune live source preferences, shared mailbox behavior, and the mailbox defaults that shape a fast team workspace."
  },
  workflows: {
    title: "Workflows",
    eyebrow: "Assistant behavior",
    description:
      "Set the reply queue defaults and desktop workflow behavior that keep the app fast, quiet, and keyboard-first."
  }
} as const;

function countSharedMailboxes(accounts: AccountSummary[]) {
  return accounts.reduce(
    (total, account) => total + account.mailboxes.filter((mailbox) => mailbox.kind === "SHARED").length,
    0
  );
}

function countAppleMailSharedMailboxCandidates(folders: AppleMailFolder[]) {
  return new Set(
    folders
      .filter((folder) => folder.depth === 0 && folder.type === "custom" && folder.name.includes("@"))
      .map((folder) => folder.name.trim().toLowerCase())
      .filter(Boolean)
  ).size;
}

function providerDescription(provider: ModelProvider) {
  switch (provider.id) {
    case "ollama":
      return "Best fit for a zero-spend local model stack with quick switching across downloaded models.";
    case "lm-studio":
      return "Friendly local OpenAI-style endpoint with desktop model management and easy experimentation.";
    case "local-openai-compatible":
      return "Use any other local endpoint that speaks the OpenAI API shape.";
    case "openai":
      return "High-quality hosted reasoning and drafting through a direct API token.";
    case "groq":
      return "Fast hosted inference when latency matters more than broad model variety.";
    case "anthropic":
      return "Hosted assistant models for drafting and summarization through a token flow.";
    case "openrouter":
      return "Route across multiple hosted models while keeping provider choice flexible.";
    case "chatgpt":
      return "ChatGPT account sign-in is not exposed as a third-party OAuth flow for this app today. Use OpenAI API for supported routing.";
    case "codex":
      return "Codex account sign-in works in OpenAI-owned surfaces, but not as a public third-party OAuth connection for this app.";
    default:
      return "Model provider routing for assistant workflows layered on top of deterministic intelligence.";
  }
}

export function SettingsApp({ section }: { section: SettingsSection }) {
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [appleMailAccounts, setAppleMailAccounts] = useState<AppleMailAccount[]>([]);
  const [appleMailFolders, setAppleMailFolders] = useState<AppleMailFolder[]>([]);
  const [catalog, setCatalog] = useState<ModelProviderCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, startSaveTransition] = useTransition();

  useEffect(() => {
    setLoading(true);

    void Promise.all([fetchSettings(), fetchAccounts(), fetchModelProviderCatalog()])
      .then(([settingsResponse, accountsResponse, catalogResponse]) => {
        setSettings(settingsResponse.settings);
        setAccounts(accountsResponse.accounts);
        setCatalog(catalogResponse);
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Failed to load Settings.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    void Promise.allSettled([fetchAppleMailAccounts(), fetchAppleMailFolders()])
      .then(([accountsResult, foldersResult]) => {
        if (accountsResult.status === "fulfilled") {
          setAppleMailAccounts(accountsResult.value.accounts);
        }

        if (foldersResult.status === "fulfilled") {
          setAppleMailFolders(foldersResult.value.folders);
        }
      });
  }, []);

  const providerOptions = useMemo(() => {
    if (!catalog || !settings) {
      return [];
    }

    return catalog.providers.filter((provider) => provider.category === settings.models.enrichmentSource.category);
  }, [catalog, settings]);

  const selectedProvider = useMemo(() => {
    if (!settings) {
      return null;
    }

    return (
      providerOptions.find((provider) => provider.id === settings.models.enrichmentSource.providerId) ?? providerOptions[0] ?? null
    );
  }, [providerOptions, settings]);

  const accountStats = useMemo(() => {
    if (!settings) {
      return {
        accountLabel: "Accounts",
        accountValue: 0,
        sharedValue: 0
      };
    }

    if (settings.accounts.preferredLiveSource === "APPLE_MAIL") {
      return {
        accountLabel: "Apple Mail accounts",
        accountValue: appleMailAccounts.length,
        sharedValue: countAppleMailSharedMailboxCandidates(appleMailFolders)
      };
    }

    return {
      accountLabel: "Imported accounts",
      accountValue: accounts.length,
      sharedValue: countSharedMailboxes(accounts)
    };
  }, [accounts, appleMailAccounts, appleMailFolders, settings]);

  const stats = useMemo(() => {
    if (!settings) {
      return [];
    }

    if (section === "models") {
      return [
        { label: "Analytics", value: "Deterministic" },
        { label: "Source", value: categoryStatLabels[settings.models.enrichmentSource.category] },
        { label: "Routing", value: settings.models.enrichmentSource.routingMode === "AUTO" ? "Auto" : "Explicit" }
      ];
    }

    if (section === "accounts") {
      return [
        { label: accountStats.accountLabel, value: accountStats.accountValue },
        { label: "Shared", value: accountStats.sharedValue },
        { label: "Live", value: liveSourceLabels[settings.accounts.preferredLiveSource] }
      ];
    }

    return [
      { label: "Queue", value: queueLabels[settings.workflows.replyQueueDefault] },
      { label: "Follow-up", value: `${settings.workflows.followUpSlaHours}h` },
      { label: "Toasts", value: settings.workflows.stackToasts ? "Stacked" : "Single" }
    ];
  }, [accountStats, section, settings]);

  function updateModelSettings(next: Partial<ModelsSettings["enrichmentSource"]>) {
    setSettings((current) => {
      if (!current) {
        return current;
      }

      const category = next.category ?? current.models.enrichmentSource.category;
      const nextProviders = catalog?.providers.filter((provider) => provider.category === category) ?? [];
      const currentProviderId =
        next.providerId ??
        (next.category && current.models.enrichmentSource.category !== next.category
          ? nextProviders[0]?.id ?? current.models.enrichmentSource.providerId
          : current.models.enrichmentSource.providerId);

      return {
        ...current,
        models: {
          ...current.models,
          enrichmentSource: {
            ...current.models.enrichmentSource,
            ...next,
            providerId: currentProviderId,
            oauthStatus:
              category === "COMPANION_ASSISTANT"
                ? next.oauthStatus ?? current.models.enrichmentSource.oauthStatus
                : "NOT_CONNECTED"
          }
        }
      };
    });
  }

  function updateAccounts(next: Partial<AccountsSettings>) {
    setSettings((current) => (current ? { ...current, accounts: { ...current.accounts, ...next } } : current));
  }

  function updateWorkflows(next: Partial<WorkflowsSettings>) {
    setSettings((current) => (current ? { ...current, workflows: { ...current.workflows, ...next } } : current));
  }

  function saveSection() {
    if (!settings) {
      return;
    }

    startSaveTransition(async () => {
      try {
        if (section === "models") {
          const response = await updateModelsSettings(settings.models);
          setSettings((current) => (current ? { ...current, models: response.settings } : current));
        } else if (section === "accounts") {
          const response = await updateAccountsSettings(settings.accounts);
          setSettings((current) => (current ? { ...current, accounts: response.settings } : current));
        } else {
          const response = await updateWorkflowsSettings(settings.workflows);
          setSettings((current) => (current ? { ...current, workflows: response.settings } : current));
        }

        toast.success(`${sectionContent[section].title} saved.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Failed to save ${sectionContent[section].title}.`);
      }
    });
  }

  if (loading || !settings || !catalog) {
    return (
      <AppShell
        workspaceKey="settings"
        secondaryLabel="Settings"
        secondaryItems={[
          { href: "/settings/models" as Route, label: "Models", icon: BrainCircuit, active: section === "models" },
          { href: "/settings/accounts" as Route, label: "Accounts", icon: FolderCog, active: section === "accounts" },
          { href: "/settings/workflows" as Route, label: "Workflows", icon: Waypoints, active: section === "workflows" }
        ]}
      >
        <div className="empty-state">Loading Settings…</div>
      </AppShell>
    );
  }

  return (
    <AppShell
      workspaceKey="settings"
      secondaryLabel="Settings"
      secondaryItems={[
        { href: "/settings/models" as Route, label: "Models", icon: BrainCircuit, active: section === "models" },
        { href: "/settings/accounts" as Route, label: "Accounts", icon: FolderCog, active: section === "accounts" },
        { href: "/settings/workflows" as Route, label: "Workflows", icon: Waypoints, active: section === "workflows" }
      ]}
      stats={stats}
    >
      <header className="client-topbar settings-topbar">
        <div className="topbar-copy">
          <div className="eyebrow">{sectionContent[section].eyebrow}</div>
          <h2>{sectionContent[section].title}</h2>
          <p>{sectionContent[section].description}</p>
        </div>

        <div className="topbar-tools">
          <span className="soft-tag">
            <CheckCircle2 size={14} />
            Deterministic analytics stay separate
          </span>
          <button className="client-button primary" disabled={isSaving} onClick={saveSection} type="button">
            <Settings2 size={16} />
            Save changes
          </button>
        </div>
      </header>

      <div className="settings-grid">
        <section className="thread-pane settings-main-pane">
          {section === "models" ? (
            <>
              <div className="settings-section-card">
                <div className="pane-header">
                  <div>
                    <div className="eyebrow">Enrichment routing</div>
                    <h3>Model source for enrichment</h3>
                  </div>
                  <span className="soft-tag">{categoryLabels[settings.models.enrichmentSource.category]}</span>
                </div>

                <p className="settings-note">
                  The desktop app currently supports local providers and cloud API tokens. Companion assistant integrations can be
                  added later without changing the deterministic mailbox graph underneath.
                </p>

                <div className="settings-choice-grid">
                  {desktopModelCategories.map((category) => (
                    <button
                      key={category}
                      className={`settings-choice-card ${settings.models.enrichmentSource.category === category ? "active" : ""}`}
                      onClick={() => {
                        const categoryProviders = catalog.providers.filter((provider) => provider.category === category);
                        updateModelSettings({
                          category,
                          providerId: categoryProviders[0]?.id ?? settings.models.enrichmentSource.providerId,
                          baseUrl: categoryProviders[0]?.defaultBaseUrl ?? null,
                          apiToken: category === "CLOUD_API_TOKEN" ? settings.models.enrichmentSource.apiToken : "",
                          oauthStatus: "NOT_CONNECTED"
                        });
                      }}
                      type="button"
                    >
                      <div className="settings-choice-head">
                        <strong>{categoryLabels[category]}</strong>
                        <span className="soft-tag">
                          {catalog.providers.filter((provider) => provider.category === category).length} providers
                        </span>
                      </div>
                      <p>{categoryDescriptions[category]}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-section-card">
                <div className="pane-header">
                  <div>
                    <div className="eyebrow">Provider</div>
                    <h3>Choose the source</h3>
                  </div>
                  <Sparkles size={18} />
                </div>

                <div className="settings-choice-grid compact">
                  {providerOptions.map((provider) => (
                    <button
                      key={provider.id}
                      className={`settings-choice-card compact ${settings.models.enrichmentSource.providerId === provider.id ? "active" : ""}`}
                      onClick={() =>
                        updateModelSettings({
                          providerId: provider.id,
                          baseUrl: provider.defaultBaseUrl ?? settings.models.enrichmentSource.baseUrl
                        })
                      }
                      type="button"
                    >
                      <div className="settings-choice-head">
                        <strong>{provider.name}</strong>
                        <span className="soft-tag">{categoryLabels[provider.category]}</span>
                      </div>
                      <p>{providerDescription(provider)}</p>
                    </button>
                  ))}
                </div>

                <div className="settings-form-grid">
                  <label className="settings-field">
                    <span>Default model</span>
                    <input
                      className="client-input"
                      onChange={(event) => updateModelSettings({ defaultModel: event.target.value })}
                      placeholder="gpt-5.4, qwen2.5:7b, claude-sonnet..."
                      value={settings.models.enrichmentSource.defaultModel}
                    />
                  </label>

                  <div className="settings-field">
                    <span>Routing mode</span>
                    <div className="segmented-control">
                      {routingModes.map((mode) => (
                        <button
                          key={mode.id}
                          className={settings.models.enrichmentSource.routingMode === mode.id ? "active" : ""}
                          onClick={() => updateModelSettings({ routingMode: mode.id })}
                          type="button"
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedProvider?.supportsBaseUrl ? (
                    <label className="settings-field">
                      <span>Base URL</span>
                      <input
                        className="client-input"
                        onChange={(event) => updateModelSettings({ baseUrl: event.target.value })}
                        placeholder={selectedProvider.defaultBaseUrl ?? "http://localhost:11434/v1"}
                        value={settings.models.enrichmentSource.baseUrl ?? ""}
                      />
                    </label>
                  ) : null}

                  {selectedProvider?.supportsApiToken ? (
                    <label className="settings-field">
                      <span>API token</span>
                      <input
                        className="client-input"
                        onChange={(event) => updateModelSettings({ apiToken: event.target.value })}
                        placeholder={
                          settings.models.enrichmentSource.hasApiToken
                            ? `Saved token ${settings.models.enrichmentSource.apiTokenPreview ?? ""}`
                            : "Paste provider token"
                        }
                        type="password"
                        value={settings.models.enrichmentSource.apiToken}
                      />
                    </label>
                  ) : null}
                </div>
              </div>

                  {settings.models.enrichmentSource.category === "COMPANION_ASSISTANT" ? (
                    <div className="settings-section-card">
                  <div className="pane-header">
                    <div>
                      <div className="eyebrow">Companion path</div>
                      <h3>Not active in the desktop app</h3>
                    </div>
                    <span className="status-tag neutral">Companion only</span>
                  </div>

                  <p className="settings-note">
                    ChatGPT/Codex-style companion integrations are not enabled in the local desktop app right now. The supported
                    paths here are local providers and direct cloud API tokens.
                  </p>
                  <p className="settings-note">
                    The app stays ready for a future companion integration, but the mailbox and deterministic analytics foundation
                    remain local-first.
                  </p>
                  <div className="settings-inline-actions">
                    <button
                      className="client-button secondary"
                          onClick={() =>
                            updateModelSettings({
                              category: "LOCAL_PROVIDER",
                              providerId: "ollama",
                              baseUrl: "http://127.0.0.1:11434",
                          oauthStatus: "NOT_CONNECTED"
                        })
                      }
                      type="button"
                    >
                      <ServerCog size={16} />
                      Switch to local provider
                    </button>
                    <button
                      className="client-button secondary"
                          onClick={() =>
                            updateModelSettings({
                              category: "CLOUD_API_TOKEN",
                              providerId: "openai",
                              baseUrl: null,
                          oauthStatus: "NOT_CONNECTED"
                        })
                      }
                      type="button"
                    >
                      <Cloud size={16} />
                      Switch to OpenAI API
                    </button>
                  </div>
                  <div className="soft-panel">
                    <div className="metric-row">
                      <span>Connection</span>
                      <strong>{settings.models.enrichmentSource.oauthAccountLabel ?? "No assistant connected yet"}</strong>
                    </div>
                    <div className="metric-row">
                      <span>Desktop mode</span>
                      <strong>Local or API token only</strong>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {section === "accounts" ? (
            <>
              <div className="settings-section-card">
              <div className="pane-header">
                <div>
                  <div className="eyebrow">Mailbox preferences</div>
                  <h3>Live source priority</h3>
                </div>
                  <ServerCog size={18} />
                </div>

                <div className="settings-choice-grid compact">
                  {Object.entries(liveSourceLabels).map(([value, label]) => (
                    <button
                      key={value}
                      className={`settings-choice-card compact ${settings.accounts.preferredLiveSource === value ? "active" : ""}`}
                      onClick={() => updateAccounts({ preferredLiveSource: value as AccountsSettings["preferredLiveSource"] })}
                      type="button"
                    >
                      <div className="settings-choice-head">
                        <strong>{label}</strong>
                        <span className="soft-tag">{value === "APPLE_MAIL" ? "Recommended on macOS" : "Available"}</span>
                      </div>
                      <p>
                        {value === "APPLE_MAIL"
                          ? "Zero-admin live mail from Mail.app on this Mac."
                          : value === "MICROSOFT_GRAPH"
                            ? "Best long-term direct OAuth route when tenant approval is available."
                            : value === "OUTLOOK_MCP"
                              ? "Graph-backed fallback through the local bridge."
                              : "Useful local fallback when Thunderbird already has the mailbox."}
                      </p>
                    </button>
                  ))}
                </div>

                <label className="settings-field">
                  <span>Default sync window</span>
                  <input
                    className="client-input"
                    min={7}
                    onChange={(event) => updateAccounts({ defaultSyncWindowDays: Number(event.target.value) || 0 })}
                    type="number"
                    value={settings.accounts.defaultSyncWindowDays}
                  />
                </label>
              </div>

              <div className="settings-section-card">
                <div className="pane-header">
                  <div>
                    <div className="eyebrow">Shared mailbox support</div>
                    <h3>Queue behavior</h3>
                  </div>
                  <Layers3 size={18} />
                </div>

                <div className="settings-toggle-grid">
                  <button
                    className={`settings-toggle-card ${settings.accounts.includeSharedMailboxesInQueues ? "active" : ""}`}
                    onClick={() =>
                      updateAccounts({ includeSharedMailboxesInQueues: !settings.accounts.includeSharedMailboxesInQueues })
                    }
                    type="button"
                  >
                    <strong>Include shared mailboxes in queues</strong>
                    <p>Keep team inboxes visible in the same keyboard-first triage flow.</p>
                  </button>
                  <button
                    className={`settings-toggle-card ${settings.accounts.prioritizeSharedMailboxes ? "active" : ""}`}
                    onClick={() => updateAccounts({ prioritizeSharedMailboxes: !settings.accounts.prioritizeSharedMailboxes })}
                    type="button"
                  >
                    <strong>Prioritize shared mailbox pressure</strong>
                    <p>Bubble shared-mail urgency higher when the workspace is team-oriented.</p>
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {section === "workflows" ? (
            <>
              <div className="settings-section-card">
                <div className="pane-header">
                  <div>
                    <div className="eyebrow">Reply queue</div>
                    <h3>Default inbox mode</h3>
                  </div>
                  <Bolt size={18} />
                </div>

                <div className="segmented-control settings-segmented">
                  {Object.entries(queueLabels).map(([value, label]) => (
                    <button
                      key={value}
                      className={settings.workflows.replyQueueDefault === value ? "active" : ""}
                      onClick={() => updateWorkflows({ replyQueueDefault: value as WorkflowsSettings["replyQueueDefault"] })}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <label className="settings-field">
                  <span>Follow-up SLA (hours)</span>
                  <input
                    className="client-input"
                    min={1}
                    onChange={(event) => updateWorkflows({ followUpSlaHours: Number(event.target.value) || 0 })}
                    type="number"
                    value={settings.workflows.followUpSlaHours}
                  />
                </label>
              </div>

              <div className="settings-section-card">
                <div className="pane-header">
                  <div>
                    <div className="eyebrow">Desktop behavior</div>
                    <h3>Keyboard-first polish</h3>
                  </div>
                  <Keyboard size={18} />
                </div>

                <div className="settings-toggle-grid">
                  <button
                    className={`settings-toggle-card ${settings.workflows.stackToasts ? "active" : ""}`}
                    onClick={() => updateWorkflows({ stackToasts: !settings.workflows.stackToasts })}
                    type="button"
                  >
                    <strong>Stack toasts</strong>
                    <p>Keep transient workflow feedback visible without blocking the reader.</p>
                  </button>
                  <button
                    className={`settings-toggle-card ${settings.workflows.keyboardHints ? "active" : ""}`}
                    onClick={() => updateWorkflows({ keyboardHints: !settings.workflows.keyboardHints })}
                    type="button"
                  >
                    <strong>Show keyboard hints</strong>
                    <p>Surface shortcut cues while the desktop interaction model keeps tightening.</p>
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </section>

        <aside className="inspector-pane settings-sidebar-pane">
          <div className="inspector-card settings-sidebar-card">
            <div className="pane-header">
              <div>
                <div className="eyebrow">Product rule</div>
                <h3>Intelligence foundation</h3>
              </div>
              <BrainCircuit size={18} />
            </div>
            <p className="inspector-copy">
              Deterministic mailbox analytics, reply-state, follow-up tasks, and client activity stay grounded in structured data.
              Settings control how enrichment, drafting, and assistant workflows sit on top.
            </p>
          </div>

          <div className="inspector-card settings-sidebar-card">
            <div className="pane-header">
              <div>
                <div className="eyebrow">Workspace summary</div>
                <h3>Connected mailbox context</h3>
              </div>
              <RefreshCcw size={18} />
            </div>
              <div className="metric-stack">
              <div className="metric-row">
                <span>{accountStats.accountLabel}</span>
                <strong>{accountStats.accountValue}</strong>
              </div>
              <div className="metric-row">
                <span>Shared mailboxes</span>
                <strong>{accountStats.sharedValue}</strong>
              </div>
              <div className="metric-row">
                <span>Preferred live source</span>
                <strong>{liveSourceLabels[settings.accounts.preferredLiveSource]}</strong>
              </div>
            </div>
          </div>

          {section === "models" && selectedProvider ? (
            <div className="inspector-card settings-sidebar-card">
              <div className="pane-header">
                <div>
                  <div className="eyebrow">Selected provider</div>
                  <h3>{selectedProvider.name}</h3>
                </div>
                {selectedProvider.category === "LOCAL_PROVIDER" ? <ServerCog size={18} /> : selectedProvider.category === "CLOUD_API_TOKEN" ? <Cloud size={18} /> : <Globe size={18} />}
              </div>
              <p className="inspector-copy">{providerDescription(selectedProvider)}</p>
            </div>
          ) : null}
        </aside>
      </div>
    </AppShell>
  );
}
