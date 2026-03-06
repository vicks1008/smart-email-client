import { MailboxKind, type Mailbox } from "@prisma/client";

import { getEnv } from "./env";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const MICROSOFT_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "email",
  "User.Read",
  "Mail.Read",
  "Mail.Read.Shared"
];

export type MicrosoftProfile = {
  id: string;
  displayName: string | null;
  mail: string | null;
  userPrincipalName: string | null;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

export type GraphRecipient = {
  emailAddress?: {
    address?: string | null;
    name?: string | null;
  };
};

export type GraphMessage = {
  id: string;
  conversationId?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  body?: {
    contentType?: string | null;
    content?: string | null;
  } | null;
  from?: GraphRecipient | null;
  toRecipients?: GraphRecipient[] | null;
  ccRecipients?: GraphRecipient[] | null;
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  webLink?: string | null;
  isRead?: boolean | null;
  importance?: string | null;
  hasAttachments?: boolean | null;
  internetMessageId?: string | null;
};

function getAuthorityBase() {
  const env = getEnv();
  return `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0`;
}

export function getMicrosoftScopes() {
  return MICROSOFT_SCOPES.join(" ");
}

export function buildMicrosoftAuthUrl(state: string) {
  const env = getEnv();
  const url = new URL(`${getAuthorityBase()}/authorize`);
  url.searchParams.set("client_id", env.MICROSOFT_CLIENT_ID ?? "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", env.MICROSOFT_REDIRECT_URI);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", getMicrosoftScopes());
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

async function exchangeToken(formData: URLSearchParams) {
  const response = await fetch(`${getAuthorityBase()}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Microsoft token exchange failed with ${response.status}.`);
  }

  const data = (await response.json()) as TokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scopes: data.scope
  };
}

export async function exchangeMicrosoftCode(code: string) {
  const env = getEnv();
  const formData = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID ?? "",
    client_secret: env.MICROSOFT_CLIENT_SECRET ?? "",
    grant_type: "authorization_code",
    code,
    redirect_uri: env.MICROSOFT_REDIRECT_URI,
    scope: getMicrosoftScopes()
  });

  return exchangeToken(formData);
}

export async function refreshMicrosoftAccessToken(refreshToken: string) {
  const env = getEnv();
  const formData = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID ?? "",
    client_secret: env.MICROSOFT_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    redirect_uri: env.MICROSOFT_REDIRECT_URI,
    scope: getMicrosoftScopes()
  });

  return exchangeToken(formData);
}

export async function graphFetch<T>(path: string, accessToken: string) {
  const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
}

export async function getMicrosoftProfile(accessToken: string) {
  return graphFetch<MicrosoftProfile>(
    "/me?$select=id,displayName,mail,userPrincipalName",
    accessToken
  );
}

export function getPrimaryMailboxIdentity(profile: MicrosoftProfile) {
  const emailAddress = profile.mail ?? profile.userPrincipalName;

  if (!emailAddress) {
    throw new Error("Microsoft profile did not include a usable mailbox address.");
  }

  return {
    externalId: "primary",
    emailAddress,
    displayName: profile.displayName ?? emailAddress,
    kind: MailboxKind.PRIMARY
  };
}

export function getMailboxResourcePath(mailbox: Pick<Mailbox, "kind" | "emailAddress">) {
  if (mailbox.kind === MailboxKind.PRIMARY) {
    return "/me";
  }

  return `/users/${encodeURIComponent(mailbox.emailAddress)}`;
}
