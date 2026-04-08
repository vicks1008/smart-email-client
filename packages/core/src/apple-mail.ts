import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getEnv } from "./env";

const execFileAsync = promisify(execFile);
const DETAIL_DELIMITER = "<<<SMART_EMAIL_BODY>>>";
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
  const { stdout, stderr } = await execFileAsync("/usr/bin/osascript", ["-e", script], {
    timeout: env.APPLE_MAIL_TIMEOUT_SECONDS * 1000,
    maxBuffer: 10 * 1024 * 1024
  });

  if (stderr?.trim()) {
    throw new Error(stderr.trim());
  }

  return stdout.trim();
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
        set end of outputLines to mbName & "${FIELD_DELIMITER}" & unreadCountText
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
      const [name, unreadCount = "0"] = line.split(FIELD_DELIMITER);
      return {
        name: name.trim(),
        unreadCount: Number.parseInt(unreadCount, 10) || 0
      };
    });
}

function mapSummaryRecord(
  record: {
    id: string;
    subject: string;
    sender: string;
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
    recipients: accountName,
    date: record.dateReceived,
    folder: mailboxName,
    folderPath: encodeFolderPath(accountName, mailboxName),
    read: record.readStatus,
    flagged: record.flagged
  } satisfies AppleMailMessageSummary;
}

async function searchMailboxMessages(input: {
  accountName: string;
  mailboxName: string;
  query?: string;
  maxResults?: number;
}) {
  const safeAccountName = escapeAppleScriptString(input.accountName);
  const safeMailboxName = escapeAppleScriptString(input.mailboxName);
  const safeQuery = escapeAppleScriptString(input.query?.trim() ?? "");
  const limit = Math.max(1, Math.min(input.maxResults ?? 60, 100));

  const condition = safeQuery
    ? `(subject of msg contains "${safeQuery}" or sender of msg contains "${safeQuery}")`
    : "true";

  const script = `
    tell application "Mail"
      set accountRef to account "${safeAccountName}"
      set mailboxRef to mailbox "${safeMailboxName}" of accountRef
      set sourceMessages to messages of mailboxRef
      set totalMessages to count of sourceMessages
      set outputLines to {}
      repeat with idx from totalMessages to 1 by -1
        if (count of outputLines) >= ${limit} then exit repeat
        set msg to item idx of sourceMessages
        if ${condition} then
          set msgId to id of msg as text
          set msgSubject to subject of msg as text
          set msgSender to sender of msg as text
          set msgDate to date received of msg as text
          set msgRead to read status of msg as text
          set msgFlagged to flagged status of msg as text
          set end of outputLines to msgId & "${FIELD_DELIMITER}" & msgSubject & "${FIELD_DELIMITER}" & msgSender & "${FIELD_DELIMITER}" & msgDate & "${FIELD_DELIMITER}" & msgRead & "${FIELD_DELIMITER}" & msgFlagged
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
    return [];
  }

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, subject, sender, dateReceived, readStatus, flagged] = line.split(FIELD_DELIMITER);
      return mapSummaryRecord(
        {
          id,
          subject,
          sender,
          dateReceived: dateReceived || null,
          readStatus: readStatus?.toLowerCase() === "true",
          flagged: flagged?.toLowerCase() === "true"
        },
        input.accountName,
        input.mailboxName
      );
    });
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
      totalMessages: 0,
      unreadMessages: folder.unreadCount,
      depth: 0
    }))
  ) satisfies AppleMailFolder[];
}

export async function getAppleMailRecentMessages(input: {
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
        mailboxName: "Inbox"
      };

  return searchMailboxMessages({
    accountName: target.accountName,
    mailboxName: target.mailboxName,
    maxResults: input.maxResults
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
        mailboxName: "Inbox"
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
              set attachmentNames to (name of every mail attachment of msg) as text
            on error
              set attachmentNames to ""
            end try
            set AppleScript's text item delimiters to oldDelims
            set headerText to accName & "${FIELD_DELIMITER}" & mbName & "${FIELD_DELIMITER}" & msgId & "${FIELD_DELIMITER}" & msgSubject & "${FIELD_DELIMITER}" & msgSender & "${FIELD_DELIMITER}" & msgDate & "${FIELD_DELIMITER}" & msgRead & "${FIELD_DELIMITER}" & msgFlagged & "${FIELD_DELIMITER}" & attachmentNames
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
                  set attachmentNames to (name of every mail attachment of msg) as text
                on error
                  set attachmentNames to ""
                end try
                set AppleScript's text item delimiters to oldDelims
                set headerText to accName & "${FIELD_DELIMITER}" & mbName & "${FIELD_DELIMITER}" & msgId & "${FIELD_DELIMITER}" & msgSubject & "${FIELD_DELIMITER}" & msgSender & "${FIELD_DELIMITER}" & msgDate & "${FIELD_DELIMITER}" & msgRead & "${FIELD_DELIMITER}" & msgFlagged & "${FIELD_DELIMITER}" & attachmentNames
                return headerText & "${DETAIL_DELIMITER}" & (content of msg as text)
              end try
            end repeat
          end repeat
          error "Message not found"
        end tell
      `;

  const output = await runAppleScript(script);
  const [header, body = ""] = output.split(DETAIL_DELIMITER);
  const [accountName, mailboxName, id, subject, sender, dateReceived, readStatus, flagged, attachmentNames = ""] =
    header.split(FIELD_DELIMITER);

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
    recipients: accountName,
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
