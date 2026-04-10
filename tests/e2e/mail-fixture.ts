import { MailboxKind } from "@prisma/client";
import {
  ensureArchiveAccount,
  ingestNormalizedMessage,
  previewFromText,
  registerMailbox,
  type NormalizedMessage
} from "../../packages/core/src/mail-sync.ts";
import { prisma } from "../../packages/core/src/db.ts";

const FIXTURE_ACCOUNT_EMAIL = "e2e-regression@smartmail.test";
const FIXTURE_ACCOUNT_NAME = "Regression Mail Workspace";
const PRIMARY_MAILBOX_EMAIL = "regression@smartmail.test";
const SHARED_MAILBOX_EMAIL = "hey@razzinteractive.com";

function daysAgo(days: number, hour = 9, minute = 0) {
  const value = new Date();
  value.setDate(value.getDate() - days);
  value.setHours(hour, minute, 0, 0);
  return value;
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function message(input: {
  externalMessageId: string;
  externalConversationId: string;
  internetMessageId: string;
  subject: string;
  fromName: string;
  fromAddress: string;
  toRecipients: Array<{ address: string; name: string }>;
  ccRecipients?: Array<{ address: string; name: string }>;
  receivedAt: Date;
  bodyText: string;
  isRead?: boolean;
  importance?: string | null;
}): NormalizedMessage {
  return {
    externalMessageId: input.externalMessageId,
    externalConversationId: input.externalConversationId,
    internetMessageId: input.internetMessageId,
    subject: input.subject,
    fromName: input.fromName,
    fromAddress: input.fromAddress,
    toRecipients: input.toRecipients,
    ccRecipients: input.ccRecipients ?? [],
    receivedAt: input.receivedAt,
    sentAt: input.receivedAt,
    bodyPreview: previewFromText(input.bodyText),
    bodyText: input.bodyText,
    bodyHtml: null,
    webLink: null,
    importance: input.importance ?? "normal",
    isRead: input.isRead ?? false,
    hasAttachments: false
  };
}

export async function cleanupMailFixture() {
  await prisma.appSettings.deleteMany();
  await prisma.account.deleteMany();
}

export async function seedMailFixture() {
  await cleanupMailFixture();

  const account = await ensureArchiveAccount({
    emailAddress: FIXTURE_ACCOUNT_EMAIL,
    displayName: FIXTURE_ACCOUNT_NAME
  });

  const primaryMailbox = await registerMailbox(account.id, {
    emailAddress: PRIMARY_MAILBOX_EMAIL,
    displayName: "Regression Inbox",
    kind: MailboxKind.PRIMARY
  });

  const teamMailbox = await registerMailbox(account.id, {
    emailAddress: SHARED_MAILBOX_EMAIL,
    displayName: "Razz Team Inbox",
    kind: MailboxKind.SHARED
  });

  await ingestNormalizedMessage(
    primaryMailbox,
    message({
      externalMessageId: "fixture-acme-1",
      externalConversationId: "fixture-acme-launch",
      internetMessageId: "<fixture-acme-1@smartmail.test>",
      subject: "Website launch decision",
      fromName: "Victor Garcia",
      fromAddress: PRIMARY_MAILBOX_EMAIL,
      toRecipients: [{ address: "amanda@acme.com", name: "Amanda Cole" }],
      receivedAt: daysAgo(2, 10, 0),
      bodyText: "Hi Amanda, I can confirm the rollout plan once I have your final launch note."
    })
  );

  await ingestNormalizedMessage(
    primaryMailbox,
    message({
      externalMessageId: "fixture-acme-2",
      externalConversationId: "fixture-acme-launch",
      internetMessageId: "<fixture-acme-2@acme.com>",
      subject: "Re: Website launch decision",
      fromName: "Amanda Cole",
      fromAddress: "amanda@acme.com",
      toRecipients: [{ address: PRIMARY_MAILBOX_EMAIL, name: "Victor Garcia" }],
      receivedAt: hoursAgo(4),
      bodyText: "Can you confirm the launch plan and the exact timing you want us to announce to the client?",
      isRead: false,
      importance: "high"
    })
  );

  await ingestNormalizedMessage(
    primaryMailbox,
    message({
      externalMessageId: "fixture-northshore-1",
      externalConversationId: "fixture-northshore-rollout",
      internetMessageId: "<fixture-northshore-1@northshore.com>",
      subject: "Resident portal rollout",
      fromName: "Ben Ortiz",
      fromAddress: "ben@northshore.com",
      toRecipients: [{ address: PRIMARY_MAILBOX_EMAIL, name: "Victor Garcia" }],
      receivedAt: daysAgo(8, 11, 15),
      bodyText: "Can you send over the rollout plan and let me know which Friday works best on your side?"
    })
  );

  await ingestNormalizedMessage(
    primaryMailbox,
    message({
      externalMessageId: "fixture-northshore-2",
      externalConversationId: "fixture-northshore-rollout",
      internetMessageId: "<fixture-northshore-2@smartmail.test>",
      subject: "Re: Resident portal rollout",
      fromName: "Victor Garcia",
      fromAddress: PRIMARY_MAILBOX_EMAIL,
      toRecipients: [{ address: "ben@northshore.com", name: "Ben Ortiz" }],
      receivedAt: daysAgo(6, 14, 20),
      bodyText: "Friday works on our side. Let me know if you want me to hold the team on that plan.",
      isRead: true
    })
  );

  await ingestNormalizedMessage(
    teamMailbox,
    message({
      externalMessageId: "fixture-team-1",
      externalConversationId: "fixture-team-review",
      internetMessageId: "<fixture-team-1@clientbrand.com>",
      subject: "Brand review feedback",
      fromName: "Casey Nguyen",
      fromAddress: "casey@clientbrand.com",
      toRecipients: [{ address: SHARED_MAILBOX_EMAIL, name: "Razz Team" }],
      receivedAt: hoursAgo(22),
      bodyText: "Sending notes on the landing page review. Can the team tighten the headline and send a revised version today?",
      isRead: false
    })
  );

  await prisma.account.update({
    where: {
      id: account.id
    },
    data: {
      displayName: FIXTURE_ACCOUNT_NAME
    }
  });
}
