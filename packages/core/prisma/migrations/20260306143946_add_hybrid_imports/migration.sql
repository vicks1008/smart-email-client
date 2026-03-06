-- CreateEnum
CREATE TYPE "ImportFormat" AS ENUM ('EML', 'OLM');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('IN_PROGRESS', 'SUCCEEDED', 'FAILED');

-- AlterEnum
ALTER TYPE "AccountProvider" ADD VALUE 'ARCHIVE';

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "tenantId" DROP NOT NULL,
ALTER COLUMN "scopes" DROP NOT NULL,
ALTER COLUMN "accessToken" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "format" "ImportFormat" NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "importedMessages" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportJob_mailboxId_createdAt_idx" ON "ImportJob"("mailboxId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ImportJob_status_createdAt_idx" ON "ImportJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
