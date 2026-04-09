ALTER TABLE "Thread"
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Thread_mailboxId_archivedAt_lastMessageAt_idx"
ON "Thread"("mailboxId", "archivedAt", "lastMessageAt" DESC);
