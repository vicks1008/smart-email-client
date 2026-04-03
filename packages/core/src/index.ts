export * from "@prisma/client";
export type { NormalizedMessage } from "./mail-sync";

export { prisma } from "./db";
export { getEnv, hasMicrosoftOAuthConfig } from "./env";
export {
  getOrganizationActivity as getOrganizationActivityAnalytics,
  type OrganizationActivityAnalytics,
  type OrganizationActivityRecord
} from "./analytics";
export { applyThreadIntelligence, inferMailboxRole, rebuildIntelligence } from "./intelligence";
export {
  getOutlookMcpAuthUrl,
  getOutlookMcpMessageDetail,
  getOutlookMcpRecentMessages,
  getOutlookMcpStatus,
  listOutlookMcpAccounts,
  listOutlookMcpFolders,
  outlookMcpSetupProbe,
  searchOutlookMcpMessages,
  type OutlookMcpAccount,
  type OutlookMcpFolder,
  type OutlookMcpMessageDetail,
  type OutlookMcpMessageSummary,
  type OutlookMcpStatus
} from "./outlook-mcp";
export {
  getThunderbirdFolderStatistics,
  getThunderbirdMessageDetail,
  getThunderbirdMessageMetadata,
  getThunderbirdRecentMessages,
  getThunderbirdRawMessage,
  getThunderbirdStatus,
  getThunderbirdThreadMessages,
  listThunderbirdMessagesInFolder,
  listThunderbirdAccounts,
  listThunderbirdDiscoveredMailboxes,
  listThunderbirdFolders,
  listThunderbirdSyncSources,
  searchThunderbirdMessages,
  syncAllThunderbirdDiscoveredMailboxes,
  syncDueThunderbirdSources,
  syncThunderbirdAccountIntoWorkbench,
  thunderbirdSetupProbe,
  type ThunderbirdAccount,
  type ThunderbirdFolder,
  type ThunderbirdFolderMessagesPage,
  type ThunderbirdFolderStatistics,
  type ThunderbirdMessageDetail,
  type ThunderbirdMessageMetadata,
  type ThunderbirdRawMessage,
  type ThunderbirdMessageSummary,
  type ThunderbirdStatus
} from "./thunderbird";
export {
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  getMailboxResourcePath,
  getMicrosoftProfile,
  getMicrosoftScopes
} from "./microsoft";
export {
  ensureArchiveAccount,
  ensureFreshAccessToken,
  hydratePrimaryMailbox,
  ingestNormalizedMessage,
  normalizeGraphMessage,
  processPendingSyncJobs,
  previewFromText,
  queueAccountSync,
  queueMailboxSync,
  registerMailbox,
  registerPrimaryMailboxForAccount,
  scheduleDueSyncs,
  syncMailbox
} from "./mail-sync";
