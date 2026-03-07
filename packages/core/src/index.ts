export * from "@prisma/client";
export type { NormalizedMessage } from "./mail-sync";

export { prisma } from "./db";
export { getEnv, hasMicrosoftOAuthConfig } from "./env";
export { applyThreadIntelligence, inferMailboxRole, rebuildIntelligence } from "./intelligence";
export {
  getThunderbirdMessageDetail,
  getThunderbirdRecentMessages,
  getThunderbirdStatus,
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
  type ThunderbirdMessageDetail,
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
