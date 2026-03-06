export * from "@prisma/client";
export type { NormalizedMessage } from "./mail-sync";

export { prisma } from "./db";
export { getEnv, hasMicrosoftOAuthConfig } from "./env";
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
