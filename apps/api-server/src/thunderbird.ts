import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getEnv } from "@smart-email/core";

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

type ThunderbirdToolResult = {
  content: Array<{
    type: string;
    text: string;
  }>;
};

export type ThunderbirdStatus = {
  available: boolean;
  profilePaths: string[];
  bridgeUrl: string;
  serverInfo?: {
    name: string;
    version: string;
  };
  error?: string;
};

export type ThunderbirdAccount = {
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

export type ThunderbirdFolder = {
  name: string;
  path: string;
  type: string;
  accountId: string;
  totalMessages: number;
  unreadMessages: number;
  depth: number;
};

export type ThunderbirdMessageSummary = {
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

export type ThunderbirdMessageDetail = ThunderbirdMessageSummary & {
  body: string;
  bodyIsHtml: boolean;
  attachments: Array<{
    name: string;
    contentType: string;
    size: number | null;
  }>;
};

type ToolsListResult = {
  tools: Array<{
    name: string;
    title?: string;
    description?: string;
  }>;
};

const DEFAULT_PROFILE_ROOT = join(homedir(), "Library", "Thunderbird", "Profiles");
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function findThunderbirdProfiles() {
  try {
    const entries = await readdir(DEFAULT_PROFILE_ROOT, {
      withFileTypes: true
    });

    const profiles = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(DEFAULT_PROFILE_ROOT, entry.name));

    return profiles;
  } catch {
    return [];
  }
}

async function thunderbirdJsonRpc<T>(payload: Record<string, unknown>) {
  const env = getEnv();
  const response = await fetch(env.THUNDERBIRD_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Thunderbird bridge returned ${response.status}.`);
  }

  const body = (await response.json()) as JsonRpcResponse<T>;

  if (body.error) {
    throw new Error(body.error.message);
  }

  if (!body.result) {
    throw new Error("Thunderbird bridge returned an empty result.");
  }

  return body.result;
}

async function callTool<T>(name: string, args: Record<string, unknown> = {}) {
  const result = await thunderbirdJsonRpc<ThunderbirdToolResult>({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: args
    }
  });

  const text = result.content.find((entry) => entry.type === "text")?.text ?? "null";
  return JSON.parse(text) as T;
}

export async function getThunderbirdStatus(): Promise<ThunderbirdStatus> {
  const env = getEnv();
  const profilePaths = await findThunderbirdProfiles();

  try {
    const tools = await thunderbirdJsonRpc<ToolsListResult>({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    });

    return {
      available: true,
      profilePaths,
      bridgeUrl: env.THUNDERBIRD_MCP_URL,
      serverInfo: {
        name: "Thunderbird MCP",
        version: `${tools.tools.length} tools`
      }
    };
  } catch (error) {
    return {
      available: false,
      profilePaths,
      bridgeUrl: env.THUNDERBIRD_MCP_URL,
      error:
        error instanceof Error
          ? error.message
          : "Thunderbird MCP bridge is not available."
    };
  }
}

export async function listThunderbirdAccounts() {
  return callTool<ThunderbirdAccount[]>("listAccounts");
}

export async function listThunderbirdFolders(accountId?: string) {
  return callTool<ThunderbirdFolder[]>("listFolders", accountId ? { accountId } : {});
}

export async function getThunderbirdRecentMessages(input: {
  folderPath?: string;
  daysBack?: number;
  maxResults?: number;
  unreadOnly?: boolean;
  flaggedOnly?: boolean;
}) {
  return callTool<ThunderbirdMessageSummary[]>("getRecentMessages", input);
}

export async function searchThunderbirdMessages(input: {
  query: string;
  folderPath?: string;
  startDate?: string;
  endDate?: string;
  maxResults?: number;
  unreadOnly?: boolean;
  flaggedOnly?: boolean;
  sortOrder?: "asc" | "desc";
}) {
  return callTool<ThunderbirdMessageSummary[]>("searchMessages", input);
}

export async function getThunderbirdMessageDetail(messageId: string, folderPath: string) {
  return callTool<ThunderbirdMessageDetail>("getMessage", {
    messageId,
    folderPath
  });
}

export async function thunderbirdSetupProbe() {
  const status = await getThunderbirdStatus();
  const extensionXpiPath = join(REPO_ROOT, "tools", "thunderbird-mcp", "dist", "thunderbird-mcp.xpi");
  let bundledXpiDetected = false;

  try {
    await access(extensionXpiPath);
    bundledXpiDetected = true;
  } catch {
    bundledXpiDetected = false;
  }

  return {
    ...status,
    bundledXpiDetected,
    extensionXpiPath: bundledXpiDetected ? extensionXpiPath : null,
    setupSteps: [
      "Install the Thunderbird MCP extension XPI in Thunderbird.",
      "Restart Thunderbird so the localhost bridge starts on port 8765.",
      "Reopen /mail and choose the Thunderbird live source."
    ]
  };
}
