import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getEnv } from "./env";

const execFileAsync = promisify(execFile);
const DETAIL_DELIMITER = "<<<SMART_EMAIL_BODY>>>";
const RECORD_DELIMITER = "<<<SMART_EMAIL_RECORD>>>";
const FIELD_DELIMITER = "|||";
const LIST_DELIMITER = ";;";

export type AppleMailStatus = {
  available: boolean;
  authenticated: boolean;
  authServerReachable: boolean;
  bridgeUrl: string;
  accountCount: number;
  error?: string;
  setupSteps?: string[];
};

export type AppleMailAccount = {
  id: string;
  name: string;
  type: string;
  identities: Array<{
    id: string;
    email: string;
    name: string;
    isDefault: boolean;
  }>;
};

export type AppleMailFolder = {
  name: string;
  path: string;
  type: string;
  accountId: string;
  totalMessages: number;
  unreadMessages: number;
  depth: number;
};

export type AppleMailMessageSummary = {
  id: string;
  subject: string;
  author: string;
  recipients: string;
  ccList?: string;
  date: string | null;
  folder: string;
  folderPath: string;
  read: boolean;
  flagged: boolean;
};

export type AppleMailMessageWindow = {
  accountId: string;
  folderPath: string;
  totalMessages: number;
  startIndex: number;
  endIndex: number;
  nextStartIndex: number | null;
  messages: AppleMailMessageSummary[];
};

export type AppleMailMessageDetail = AppleMailMessageSummary & {
  accountId: string | null;
  accountName: string | null;
  serverType: string | null;
  folderType: string | null;
  messageKey: number | null;
  threadId: string | null;
  threadParent: number | null;
  references: string[];
  inReplyTo: string | null;
  size: number | null;
  lineCount: number | null;
  priority: string | null;
  keywords: string;
  charset: string | null;
  body: string;
  bodyIsHtml: boolean;
  attachments: Array<{
    name: string;
    contentType: string;
    size: number | null;
  }>;
};

export type AppleMailSyncMessage = AppleMailMessageDetail;

type ParsedFolderPath = {
  accountName: string;
  mailboxName: string;
};

function escapeAppleScriptString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function mapMailboxType(name: string) {
  const normalized = name.trim().toLowerCase();
  if (normalized === "inbox") return "inbox";
  if (normalized === "sent items" || normalized === "sent") return "sent";
  if (normalized === "drafts") return "drafts";
  if (normalized === "deleted items" || normalized === "trash") return "trash";
  if (normalized === "junk email" || normalized === "junk") return "junk";
  if (normalized === "archive") return "archive";
  return "custom";
}

function encodeFolderPath(accountName: string, mailboxName: string) {
  return `${accountName}${FIELD_DELIMITER}${mailboxName}`;
}

function parseFolderPath(folderPath: string): ParsedFolderPath {
  const [accountName, mailboxName] = folderPath.split(FIELD_DELIMITER);
  if (!accountName || !mailboxName) {
    throw new Error("Apple Mail folder path is invalid.");
  }

  return { accountName, mailboxName };
}

async function runAppleScript(script: string) {
  const env = getEnv();
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { stdout, stderr } = await execFileAsync("/usr/bin/osascript", ["-e", script], {
        timeout: env.APPLE_MAIL_TIMEOUT_SECONDS * 1000,
        maxBuffer: 10 * 1024 * 1024
      });

      if (stderr?.trim()) {
        throw new Error(stderr.trim());
      }

      return stdout.trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Apple Mail automation failed.";
      const isTimeout = message.includes("AppleEvent timed out") || message.includes("timed out");
      if (!isTimeout || attempt === maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }

  throw new Error("Apple Mail automation failed.");
}

async function listAccountsRaw() {
  const script = `
    tell application "Mail"
      set outputLines to {}
      repeat with acc in accounts
        set accName to name of acc as text
        set oldDelims to AppleScript's text item delimiters
        set AppleScript's text item delimiters to "${LIST_DELIMITER}"
        set emailsText to (email addresses of acc) as text
        set AppleScript's text item delimiters to oldDelims
        set end of outputLines to accName & "${FIELD_DELIMITER}" & emailsText
      end repeat
      set oldDelims to AppleScript's text item delimiters
      set AppleScript's text item delimiters to linefeed
      set finalOutput to outputLines as text
      set AppleScript's text item delimiters to oldDelims
      return finalOutput
    end tell
  `;

  const output = await runAppleScript(script);
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, emailsText = ""] = line.split(FIELD_DELIMITER);
      const emails = emailsText
        .split(LIST_DELIMITER)
        .map((email) => email.trim())
        .filter(Boolean);

      return {
        name: name.trim(),
        emails
      };
    });
}

async function listMailboxesRaw(accountName: string) {
  const safeAccountName = escapeAppleScriptString(accountName);
  const script = `
    tell application "Mail"
      set accountRef to account "${safeAccountName}"
      set outputLines to {}
      repeat with mb in mailboxes of accountRef
        set mbName to name of mb as text
        set unreadCountText to unread count of mb as text
        set totalCountText to (count of messages of mb) as text
        set end of outputLines to mbName & "${FIELD_DELIMITER}" & unreadCountText & "${FIELD_DELIMITER}" & totalCountText
      end repeat
      set oldDelims to AppleScript's text item delimiters
      set AppleScript's text item delimiters to linefeed
      set finalOutput to outputLines as text
      set AppleScript's text item delimiters to oldDelims
      return finalOutput
    end tell
  `;

  const output = await runAppleScript(script);
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, unreadCount = "0", totalCount = "0"] = line.split(FIELD_DELIMITER);
      return {
        name: name.trim(),
        unreadCount: Number.parseInt(unreadCount, 10) || 0,
        totalCount: Number.parseInt(totalCount, 10) || 0
      };
    });
}

function mapSummaryRecord(
  record: {
    id: string;
    subject: string;
    sender: string;
    recipients: string;
    ccList: string;
    dateReceived: string | null;
    readStatus: boolean;
    flagged: boolean;
  },
  accountName: string,
  mailboxName: string
) {
  return {
    id: record.id,
    subject: record.subject || "(no subject)",
    author: record.sender || "Unknown sender",
    recipients: record.recipients || accountName,
    ccList: record.ccList || undefined,
    date: record.dateReceived,
    folder: mailboxName,
    folderPath: encodeFolderPath(accountName, mailboxName),
    read: record.readStatus,
    flagged: record.flagged
  } satisfies AppleMailMessageSummary;
}

function parseAppleMailDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/\u202f|\u00a0/g, " ")
    .replace(/\s+at\s+/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  const candidates = [normalized, normalized.replace(/^[A-Za-z]+,\s*/, "")];

  for (const candidate of candidates) {
    const parsed = new Date(candidate);
    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function parsedAppleMailTime(value: string | null | undefined) {
  return parseAppleMailDate(value)?.getTime() ?? Number.NEGATIVE_INFINITY;
}

function sortAppleMailSummariesNewestFirst(messages: AppleMailMessageSummary[], limit?: number) {
  const ordered = [...messages].sort((left, right) => parsedAppleMailTime(right.date) - parsedAppleMailTime(left.date));
  return typeof limit === "number" ? ordered.slice(0, limit) : ordered;
}

async function preferredMailboxName(accountName: string) {
  const mailboxes = await listMailboxesRaw(accountName);
  const preferred =
    mailboxes.find((mailbox) => mapMailboxType(mailbox.name) === "inbox")?.name ??
    mailboxes.find((mailbox) => mailbox.name.trim().toLowerCase() === "inbox")?.name ??
    mailboxes[0]?.name;

  if (!preferred) {
    throw new Error(`No mailboxes were found for Apple Mail account "${accountName}".`);
  }

  return preferred;
}

async function readMailboxMessageWindow(input: {
  accountName: string;
  mailboxName: string;
  query?: string;
  maxResults?: number;
  recentDays?: number;
  startIndex?: number;
}) {
  const safeAccountName = escapeAppleScriptString(input.accountName);
  const safeMailboxName = escapeAppleScriptString(input.mailboxName);
  const safeQuery = escapeAppleScriptString(input.query?.trim() ?? "");
  const limit = Math.max(1, Math.min(input.maxResults ?? 60, 250));
  const recentDays = input.recentDays ? Math.max(1, Math.min(input.recentDays, 3650)) : null;
  const scanMultiplier = safeQuery ? 25 : recentDays ? 12 : 4;
  const maxScanLimit = safeQuery ? 600 : recentDays ? 300 : 120;
  const requestedStartIndex = Math.max(1, input.startIndex ?? 1);
  const recentSetup = recentDays
    ? `set cutoffDate to (current date) - (${recentDays} * days)`
    : "";
  const queryCheck = safeQuery
    ? `
        if msgSubject does not contain "${safeQuery}" and msgSender does not contain "${safeQuery}" then
          set matchesQuery to false
        else
          set matchesQuery to true
        end if
      `
    : "set matchesQuery to true";
  const cutoffCheck = recentDays
    ? `
        if msgDateValue is less than cutoffDate then exit repeat
      `
    : "";

  const script = `
    tell application "Mail"
      set accountRef to account "${safeAccountName}"
      set mailboxRef to mailbox "${safeMailboxName}" of accountRef
      ${recentSetup}
      set totalMessages to count of messages of mailboxRef
      if totalMessages is 0 then
        return "__SMART_EMAIL_META__${FIELD_DELIMITER}0${FIELD_DELIMITER}0${FIELD_DELIMITER}0"
      end if
      set startIndex to ${requestedStartIndex}
      if startIndex > totalMessages then
        return "__SMART_EMAIL_META__${FIELD_DELIMITER}" & totalMessages & "${FIELD_DELIMITER}" & (totalMessages + 1) & "${FIELD_DELIMITER}" & totalMessages
      end if
      set remainingMessages to totalMessages - startIndex + 1
      set scanCount to remainingMessages
      if ${safeQuery ? "true" : "false"} or ${recentDays ? "true" : "false"} then
        set preferredScanCount to ${Math.max(limit, Math.min(limit * scanMultiplier, maxScanLimit))}
        if scanCount > preferredScanCount then set scanCount to preferredScanCount
      else
        if scanCount > ${limit} then set scanCount to ${limit}
      end if
      set endIndex to startIndex + scanCount - 1
      set outputLines to {}
      set end of outputLines to "__SMART_EMAIL_META__" & "${FIELD_DELIMITER}" & totalMessages & "${FIELD_DELIMITER}" & startIndex & "${FIELD_DELIMITER}" & endIndex
      repeat with idx from startIndex to endIndex
        if ((count of outputLines) - 1) >= ${limit} then exit repeat
        set msg to message idx of mailboxRef
        set msgDateValue to date received of msg
        ${cutoffCheck}
        set msgSubject to ""
        set msgSender to ""
        try
          set msgSubject to subject of msg as text
        end try
        try
          set msgSender to sender of msg as text
        end try
        ${queryCheck}
        if matchesQuery then
          set msgId to id of msg as text
          set msgDate to msgDateValue as text
          set msgRead to read status of msg as text
          set msgFlagged to flagged status of msg as text
          set oldDelims to AppleScript's text item delimiters
          set AppleScript's text item delimiters to "${LIST_DELIMITER}"
          try
            set msgRecipients to (address of every to recipient of msg) as text
          on error
            set msgRecipients to ""
          end try
          try
            set msgCcList to (address of every cc recipient of msg) as text
          on error
            set msgCcList to ""
          end try
          set AppleScript's text item delimiters to oldDelims
          set end of outputLines to msgId & "${FIELD_DELIMITER}" & msgSubject & "${FIELD_DELIMITER}" & msgSender & "${FIELD_DELIMITER}" & msgRecipients & "${FIELD_DELIMITER}" & msgCcList & "${FIELD_DELIMITER}" & msgDate & "${FIELD_DELIMITER}" & msgRead & "${FIELD_DELIMITER}" & msgFlagged
        end if
      end repeat
      set oldDelims to AppleScript's text item delimiters
      set AppleScript's text item delimiters to linefeed
      set finalOutput to outputLines as text
      set AppleScript's text item delimiters to oldDelims
      return finalOutput
    end tell
  `;

  const output = await runAppleScript(script);
  if (!output) {
    return {
      accountId: input.accountName,
      folderPath: encodeFolderPath(input.accountName, input.mailboxName),
      totalMessages: 0,
      startIndex: requestedStartIndex,
      endIndex: requestedStartIndex - 1,
      nextStartIndex: null,
      messages: []
    } satisfies AppleMailMessageWindow;
  }

  const lines = output.split("\n").filter(Boolean);
  const [metaLine, ...recordLines] = lines;
  const [, totalMessagesText = "0", startIndexText = String(requestedStartIndex), endIndexText = String(requestedStartIndex - 1)] =
    metaLine?.split(FIELD_DELIMITER) ?? [];
  const totalMessages = Number.parseInt(totalMessagesText, 10) || 0;
  const startIndex = Number.parseInt(startIndexText, 10) || requestedStartIndex;
  const endIndex = Number.parseInt(endIndexText, 10) || startIndex - 1;

  const records = recordLines.map((line) => {
      const [id, subject, sender, recipients = "", ccList = "", dateReceived, readStatus, flagged] =
        line.split(FIELD_DELIMITER);
      return mapSummaryRecord(
        {
          id,
          subject,
          sender,
          recipients,
          ccList,
          dateReceived: dateReceived || null,
          readStatus: readStatus?.toLowerCase() === "true",
          flagged: flagged?.toLowerCase() === "true"
        },
        input.accountName,
        input.mailboxName
      );
    });

  const messages = sortAppleMailSummariesNewestFirst(records, limit);
  const nextStartIndex = endIndex < totalMessages ? endIndex + 1 : null;

  return {
    accountId: input.accountName,
    folderPath: encodeFolderPath(input.accountName, input.mailboxName),
    totalMessages,
    startIndex,
    endIndex,
    nextStartIndex,
    messages
  } satisfies AppleMailMessageWindow;
}

async function searchMailboxMessages(input: {
  accountName: string;
  mailboxName: string;
  query?: string;
  maxResults?: number;
  recentDays?: number;
  startIndex?: number;
}) {
  const window = await readMailboxMessageWindow(input);
  return window.messages;
}

export async function getAppleMailStatus(): Promise<AppleMailStatus> {
  try {
    const accounts = await listAccountsRaw();
    return {
      available: true,
      authenticated: true,
      authServerReachable: true,
      bridgeUrl: "Mail.app Automation",
      accountCount: accounts.length
    };
  } catch (error) {
    return {
      available: false,
      authenticated: false,
      authServerReachable: false,
      bridgeUrl: "Mail.app Automation",
      accountCount: 0,
      error: error instanceof Error ? error.message : "Apple Mail is not available.",
      setupSteps: [
        "Open Mail.app and confirm the mailbox is syncing there.",
        "Grant Automation access to your terminal or app in macOS Privacy & Security settings.",
        "Refresh the live workspace after Mail.app access is allowed."
      ]
    };
  }
}

export async function listAppleMailAccounts() {
  const accounts = await listAccountsRaw();
  return accounts.map((account) => ({
    id: account.name,
    name: account.name,
    type: "APPLE_MAIL",
    identities:
      account.emails.length > 0
        ? account.emails.map((email, index) => ({
            id: `${account.name}:${email}`,
            email,
            name: email,
            isDefault: index === 0
          }))
        : [
            {
              id: `${account.name}:default`,
              email: account.name,
              name: account.name,
              isDefault: true
            }
          ]
  })) satisfies AppleMailAccount[];
}

export async function listAppleMailFolders(accountId?: string) {
  const accounts = await listAccountsRaw();
  const selectedAccounts = accountId ? accounts.filter((account) => account.name === accountId) : accounts;
  const folderGroups = await Promise.all(
    selectedAccounts.map(async (account) => ({
      account,
      folders: await listMailboxesRaw(account.name)
    }))
  );

  return folderGroups.flatMap(({ account, folders }) =>
    folders.map((folder) => ({
      name: folder.name,
      path: encodeFolderPath(account.name, folder.name),
      type: mapMailboxType(folder.name),
      accountId: account.name,
      totalMessages: folder.totalCount,
      unreadMessages: folder.unreadCount,
      depth: 0
    }))
  ) satisfies AppleMailFolder[];
}

export async function getAppleMailMessageWindow(input: {
  folderPath?: string;
  maxResults?: number;
  accountId?: string;
  recentDays?: number;
  startIndex?: number;
}) {
  const accounts = await listAccountsRaw();
  const fallbackAccount = input.accountId
    ? accounts.find((account) => account.name === input.accountId)
    : accounts[0];

  if (!fallbackAccount) {
    return {
      accountId: "",
      folderPath: "",
      totalMessages: 0,
      startIndex: 1,
      endIndex: 0,
      nextStartIndex: null,
      messages: []
    } satisfies AppleMailMessageWindow;
  }

  const target = input.folderPath
    ? parseFolderPath(input.folderPath)
    : {
        accountName: fallbackAccount.name,
        mailboxName: await preferredMailboxName(fallbackAccount.name)
      };

  return readMailboxMessageWindow({
    accountName: target.accountName,
    mailboxName: target.mailboxName,
    maxResults: input.maxResults,
    recentDays: input.recentDays,
    startIndex: input.startIndex
  });
}

export async function getAppleMailRecentMessages(input: {
  folderPath?: string;
  maxResults?: number;
  accountId?: string;
  recentDays?: number;
}) {
  const window = await getAppleMailMessageWindow(input);
  return window.messages;
}

export async function getAppleMailRecentMessagesFromFolder(folderPath: string, maxResults?: number, recentDays?: number) {
  const window = await getAppleMailMessageWindow({
    folderPath,
    maxResults,
    recentDays
  });
  return window.messages;
}

export async function getAppleMailMessageWindowFromFolder(
  folderPath: string,
  input?: {
    maxResults?: number;
    recentDays?: number;
    startIndex?: number;
  }
) {
  return getAppleMailMessageWindow({
    folderPath,
    maxResults: input?.maxResults,
    recentDays: input?.recentDays,
    startIndex: input?.startIndex
  });
}

export async function searchAppleMailMessages(input: {
  query: string;
  folderPath?: string;
  maxResults?: number;
  accountId?: string;
}) {
  const accounts = await listAccountsRaw();
  const fallbackAccount = input.accountId
    ? accounts.find((account) => account.name === input.accountId)
    : accounts[0];

  if (!fallbackAccount) {
    return [];
  }

  const target = input.folderPath
    ? parseFolderPath(input.folderPath)
    : {
        accountName: fallbackAccount.name,
        mailboxName: await preferredMailboxName(fallbackAccount.name)
      };

  return searchMailboxMessages({
    accountName: target.accountName,
    mailboxName: target.mailboxName,
    query: input.query,
    maxResults: input.maxResults
  });
}

export async function getAppleMailMessageDetail(messageId: string, folderPath?: string) {
  const safeMessageId = escapeAppleScriptString(messageId);
  const script = folderPath
    ? (() => {
        const target = parseFolderPath(folderPath);
        const safeAccountName = escapeAppleScriptString(target.accountName);
        const safeMailboxName = escapeAppleScriptString(target.mailboxName);

        return `
          tell application "Mail"
            set acc to account "${safeAccountName}"
            set accName to name of acc as text
            set mb to mailbox "${safeMailboxName}" of acc
            set mbName to name of mb as text
            set msg to first message of mb whose id is ${safeMessageId}
            set msgId to id of msg as text
            set msgSubject to subject of msg as text
            set msgSender to sender of msg as text
            set msgDate to date received of msg as text
            set msgRead to read status of msg as text
            set msgFlagged to flagged status of msg as text
            set oldDelims to AppleScript's text item delimiters
            set AppleScript's text item delimiters to "${LIST_DELIMITER}"
            try
              set msgRecipients to (address of every to recipient of msg) as text
            on error
              set msgRecipients to ""
            end try
            try
              set msgCcList to (address of every cc recipient of msg) as text
            on error
              set msgCcList to ""
            end try
            try
              set attachmentNames to (name of every mail attachment of msg) as text
            on error
              set attachmentNames to ""
            end try
            set AppleScript's text item delimiters to oldDelims
            set headerText to accName & "${FIELD_DELIMITER}" & mbName & "${FIELD_DELIMITER}" & msgId & "${FIELD_DELIMITER}" & msgSubject & "${FIELD_DELIMITER}" & msgSender & "${FIELD_DELIMITER}" & msgRecipients & "${FIELD_DELIMITER}" & msgCcList & "${FIELD_DELIMITER}" & msgDate & "${FIELD_DELIMITER}" & msgRead & "${FIELD_DELIMITER}" & msgFlagged & "${FIELD_DELIMITER}" & attachmentNames
            return headerText & "${DETAIL_DELIMITER}" & (content of msg as text)
          end tell
        `;
      })()
    : `
        tell application "Mail"
          repeat with acc in accounts
            set accName to name of acc as text
            repeat with mb in mailboxes of acc
              set mbName to name of mb as text
              try
                set msg to first message of mb whose id is ${safeMessageId}
                set msgId to id of msg as text
                set msgSubject to subject of msg as text
                set msgSender to sender of msg as text
                set msgDate to date received of msg as text
                set msgRead to read status of msg as text
                set msgFlagged to flagged status of msg as text
                set oldDelims to AppleScript's text item delimiters
                set AppleScript's text item delimiters to "${LIST_DELIMITER}"
                try
                  set msgRecipients to (address of every to recipient of msg) as text
                on error
                  set msgRecipients to ""
                end try
                try
                  set msgCcList to (address of every cc recipient of msg) as text
                on error
                  set msgCcList to ""
                end try
                try
                  set attachmentNames to (name of every mail attachment of msg) as text
                on error
                  set attachmentNames to ""
                end try
                set AppleScript's text item delimiters to oldDelims
                set headerText to accName & "${FIELD_DELIMITER}" & mbName & "${FIELD_DELIMITER}" & msgId & "${FIELD_DELIMITER}" & msgSubject & "${FIELD_DELIMITER}" & msgSender & "${FIELD_DELIMITER}" & msgRecipients & "${FIELD_DELIMITER}" & msgCcList & "${FIELD_DELIMITER}" & msgDate & "${FIELD_DELIMITER}" & msgRead & "${FIELD_DELIMITER}" & msgFlagged & "${FIELD_DELIMITER}" & attachmentNames
                return headerText & "${DETAIL_DELIMITER}" & (content of msg as text)
              end try
            end repeat
          end repeat
          error "Message not found"
        end tell
      `;

  const output = await runAppleScript(script);
  const [header, body = ""] = output.split(DETAIL_DELIMITER);
  const [
    accountName,
    mailboxName,
    id,
    subject,
    sender,
    recipients = "",
    ccList = "",
    dateReceived,
    readStatus,
    flagged,
    attachmentNames = ""
  ] = header.split(FIELD_DELIMITER);

  const attachments = attachmentNames
    .split(LIST_DELIMITER)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({
      name,
      contentType: "application/octet-stream",
      size: null
    }));

  return {
    id,
    subject: subject || "(no subject)",
    author: sender || "Unknown sender",
    recipients: recipients || accountName,
    ccList: ccList || undefined,
    date: dateReceived || null,
    folder: mailboxName,
    folderPath: encodeFolderPath(accountName, mailboxName),
    read: readStatus?.toLowerCase() === "true",
    flagged: flagged?.toLowerCase() === "true",
    accountId: accountName,
    accountName,
    serverType: "apple-mail",
    folderType: mapMailboxType(mailboxName),
    messageKey: null,
    threadId: null,
    threadParent: null,
    references: [],
    inReplyTo: null,
    size: null,
    lineCount: body ? body.split("\n").length : 0,
    priority: null,
    keywords: "",
    charset: null,
    body,
    bodyIsHtml: false,
    attachments
  } satisfies AppleMailMessageDetail;
}

export async function getAppleMailRecentMessagesForSync(input: {
  folderPath?: string;
  maxResults?: number;
  accountId?: string;
  recentDays?: number;
}) {
  const accounts = await listAccountsRaw();
  const fallbackAccount = input.accountId
    ? accounts.find((account) => account.name === input.accountId)
    : accounts[0];

  if (!fallbackAccount) {
    return [];
  }

  const target = input.folderPath
    ? parseFolderPath(input.folderPath)
    : {
        accountName: fallbackAccount.name,
        mailboxName: await preferredMailboxName(fallbackAccount.name)
      };
  const summaries = await searchMailboxMessages({
    accountName: target.accountName,
    mailboxName: target.mailboxName,
    maxResults: input.maxResults,
    recentDays: input.recentDays
  });

  return Promise.all(
    summaries.map((summary) => getAppleMailMessageDetail(summary.id, summary.folderPath))
  );
}
