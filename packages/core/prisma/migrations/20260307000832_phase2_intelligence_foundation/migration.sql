-- CreateEnum
CREATE TYPE "MailboxRole" AS ENUM ('PERSONAL', 'SHARED', 'TEAM');

-- CreateEnum
CREATE TYPE "OrganizationKind" AS ENUM ('INTERNAL', 'CLIENT', 'VENDOR', 'LEAD', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MessageCategoryLabel" AS ENUM ('CLIENT', 'LEAD', 'VENDOR', 'INTERNAL', 'BILLING', 'SUPPORT', 'NEWSLETTER', 'NOTIFICATION');

-- CreateEnum
CREATE TYPE "MessageCategorySource" AS ENUM ('DOMAIN', 'SIGNATURE', 'THREAD_HISTORY', 'HEURISTIC', 'MANUAL', 'MODEL');

-- CreateEnum
CREATE TYPE "ReplyStateStatus" AS ENUM ('NEEDS_REPLY', 'WAITING_ON_THEM', 'CLOSED_LOOP', 'FOLLOW_UP_LATER');

-- CreateEnum
CREATE TYPE "FollowUpTaskStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "FollowUpTaskSource" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "Mailbox" ADD COLUMN     "ownerContactId" TEXT,
ADD COLUMN     "ownerOrganizationId" TEXT,
ADD COLUMN     "role" "MailboxRole" NOT NULL DEFAULT 'PERSONAL';

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "primaryDomain" TEXT,
    "kind" "OrganizationKind" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "roleTitle" TEXT,
    "isMailboxOwner" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEmailAddress" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactEmailAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadParticipant" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "contactId" TEXT,
    "organizationId" TEXT,
    "emailAddress" TEXT NOT NULL,
    "displayName" TEXT,
    "isMailbox" BOOLEAN NOT NULL DEFAULT false,
    "isSharedMailbox" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreadParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageCategory" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "organizationId" TEXT,
    "label" "MessageCategoryLabel" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" "MessageCategorySource" NOT NULL,
    "isUserOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplyState" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "status" "ReplyStateStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "needsReply" BOOLEAN NOT NULL DEFAULT false,
    "waitingOnThem" BOOLEAN NOT NULL DEFAULT false,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "replyDueAt" TIMESTAMP(3),
    "staleAt" TIMESTAMP(3),
    "suggestedFollowUpAt" TIMESTAMP(3),
    "isOverdue" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplyState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpTask" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "organizationId" TEXT,
    "contactId" TEXT,
    "source" "FollowUpTaskSource" NOT NULL,
    "status" "FollowUpTaskStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "note" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_normalizedName_key" ON "Organization"("normalizedName");

-- CreateIndex
CREATE INDEX "Organization_primaryDomain_idx" ON "Organization"("primaryDomain");

-- CreateIndex
CREATE INDEX "Organization_kind_name_idx" ON "Organization"("kind", "name");

-- CreateIndex
CREATE INDEX "Contact_organizationId_normalizedName_idx" ON "Contact"("organizationId", "normalizedName");

-- CreateIndex
CREATE INDEX "Contact_normalizedName_idx" ON "Contact"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "ContactEmailAddress_emailAddress_key" ON "ContactEmailAddress"("emailAddress");

-- CreateIndex
CREATE INDEX "ContactEmailAddress_contactId_idx" ON "ContactEmailAddress"("contactId");

-- CreateIndex
CREATE INDEX "ContactEmailAddress_domain_idx" ON "ContactEmailAddress"("domain");

-- CreateIndex
CREATE INDEX "ThreadParticipant_contactId_idx" ON "ThreadParticipant"("contactId");

-- CreateIndex
CREATE INDEX "ThreadParticipant_organizationId_idx" ON "ThreadParticipant"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadParticipant_threadId_emailAddress_key" ON "ThreadParticipant"("threadId", "emailAddress");

-- CreateIndex
CREATE UNIQUE INDEX "MessageCategory_messageId_key" ON "MessageCategory"("messageId");

-- CreateIndex
CREATE INDEX "MessageCategory_threadId_label_idx" ON "MessageCategory"("threadId", "label");

-- CreateIndex
CREATE INDEX "MessageCategory_organizationId_label_idx" ON "MessageCategory"("organizationId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "ReplyState_threadId_key" ON "ReplyState"("threadId");

-- CreateIndex
CREATE INDEX "ReplyState_mailboxId_status_replyDueAt_idx" ON "ReplyState"("mailboxId", "status", "replyDueAt");

-- CreateIndex
CREATE INDEX "ReplyState_mailboxId_isOverdue_suggestedFollowUpAt_idx" ON "ReplyState"("mailboxId", "isOverdue", "suggestedFollowUpAt");

-- CreateIndex
CREATE INDEX "FollowUpTask_mailboxId_status_dueAt_idx" ON "FollowUpTask"("mailboxId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUpTask_threadId_status_idx" ON "FollowUpTask"("threadId", "status");

-- CreateIndex
CREATE INDEX "FollowUpTask_organizationId_status_dueAt_idx" ON "FollowUpTask"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Mailbox_ownerOrganizationId_idx" ON "Mailbox"("ownerOrganizationId");

-- CreateIndex
CREATE INDEX "Mailbox_ownerContactId_idx" ON "Mailbox"("ownerContactId");

-- AddForeignKey
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_ownerOrganizationId_fkey" FOREIGN KEY ("ownerOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_ownerContactId_fkey" FOREIGN KEY ("ownerContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEmailAddress" ADD CONSTRAINT "ContactEmailAddress_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadParticipant" ADD CONSTRAINT "ThreadParticipant_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadParticipant" ADD CONSTRAINT "ThreadParticipant_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadParticipant" ADD CONSTRAINT "ThreadParticipant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageCategory" ADD CONSTRAINT "MessageCategory_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageCategory" ADD CONSTRAINT "MessageCategory_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageCategory" ADD CONSTRAINT "MessageCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyState" ADD CONSTRAINT "ReplyState_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyState" ADD CONSTRAINT "ReplyState_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
