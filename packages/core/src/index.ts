export * from "@prisma/client";

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
  ensureFreshAccessToken,
  hydratePrimaryMailbox,
  processPendingSyncJobs,
  queueAccountSync,
  queueMailboxSync,
  registerMailbox,
  registerPrimaryMailboxForAccount,
  scheduleDueSyncs,
  syncMailbox
} from "./mail-sync";
