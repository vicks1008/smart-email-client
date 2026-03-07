-- CreateTable
CREATE TABLE "ThunderbirdSyncSource" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "thunderbirdAccountId" TEXT NOT NULL,
    "thunderbirdAccountName" TEXT NOT NULL,
    "thunderbirdIdentityId" TEXT,
    "thunderbirdIdentityEmail" TEXT,
    "thunderbirdIdentityName" TEXT,
    "daysBack" INTEGER NOT NULL DEFAULT 45,
    "maxMessagesPerFolder" INTEGER NOT NULL DEFAULT 250,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThunderbirdSyncSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ThunderbirdSyncSource_mailboxId_key" ON "ThunderbirdSyncSource"("mailboxId");

-- CreateIndex
CREATE INDEX "ThunderbirdSyncSource_enabled_lastSyncedAt_idx" ON "ThunderbirdSyncSource"("enabled", "lastSyncedAt");

-- CreateIndex
CREATE INDEX "ThunderbirdSyncSource_thunderbirdAccountId_idx" ON "ThunderbirdSyncSource"("thunderbirdAccountId");

-- AddForeignKey
ALTER TABLE "ThunderbirdSyncSource" ADD CONSTRAINT "ThunderbirdSyncSource_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
