import { randomUUID } from "node:crypto";

import {
  AccountProvider,
  SyncTrigger,
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  getEnv,
  hasMicrosoftOAuthConfig,
  prisma,
  queueAccountSync,
  registerPrimaryMailboxForAccount
} from "@smart-email/core";
import type { FastifyInstance } from "fastify";

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/v1/auth/microsoft/start", async (request, reply) => {
    if (!hasMicrosoftOAuthConfig()) {
      return reply.status(500).send({
        error: "Microsoft OAuth is not configured. Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET."
      });
    }

    const redirectTarget =
      typeof request.query === "object" &&
      request.query !== null &&
      "redirect" in request.query &&
      typeof request.query.redirect === "string"
        ? request.query.redirect
        : `${getEnv().DASHBOARD_URL}/mail`;

    const state = randomUUID();

    await prisma.oAuthState.create({
      data: {
        state,
        provider: AccountProvider.MICROSOFT,
        postAuthRedirect: redirectTarget
      }
    });

    return reply.redirect(buildMicrosoftAuthUrl(state));
  });

  app.get("/v1/auth/microsoft/callback", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const code = query.code;
    const state = query.state;
    const oauthError = query.error_description ?? query.error;

    if (oauthError) {
      return reply.redirect(`${getEnv().DASHBOARD_URL}/mail?error=${encodeURIComponent(oauthError)}`);
    }

    if (!code || !state) {
      return reply.status(400).send({
        error: "Microsoft callback requires both code and state."
      });
    }

    const stateRecord = await prisma.oAuthState.findUnique({
      where: {
        state
      }
    });

    if (!stateRecord) {
      return reply.status(400).send({
        error: "OAuth state was missing or expired."
      });
    }

    try {
      const token = await exchangeMicrosoftCode(code);
      const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: "application/json"
        }
      });

      if (!profileResponse.ok) {
        throw new Error(`Failed to fetch Microsoft profile (${profileResponse.status}).`);
      }

      const profile = (await profileResponse.json()) as {
        id: string;
        displayName?: string | null;
        mail?: string | null;
        userPrincipalName?: string | null;
      };

      const email = profile.mail ?? profile.userPrincipalName;

      if (!email) {
        throw new Error("Microsoft profile did not include an email address.");
      }

      const account = await prisma.account.upsert({
        where: {
          provider_externalUserId: {
            provider: AccountProvider.MICROSOFT,
            externalUserId: profile.id
          }
        },
        update: {
          tenantId: getEnv().MICROSOFT_TENANT_ID,
          email,
          displayName: profile.displayName ?? email,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          tokenExpiresAt: token.expiresAt,
          scopes: token.scopes
        },
        create: {
          provider: AccountProvider.MICROSOFT,
          tenantId: getEnv().MICROSOFT_TENANT_ID,
          externalUserId: profile.id,
          email,
          displayName: profile.displayName ?? email,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          tokenExpiresAt: token.expiresAt,
          scopes: token.scopes
        }
      });

      await registerPrimaryMailboxForAccount(account.id, token.accessToken);
      await queueAccountSync(account.id, SyncTrigger.OAUTH_CALLBACK);
      await prisma.oAuthState.delete({
        where: {
          id: stateRecord.id
        }
      });

      return reply.redirect(
        `${stateRecord.postAuthRedirect ?? `${getEnv().DASHBOARD_URL}/mail`}?connected=1`
      );
    } catch (error) {
      await prisma.oAuthState.delete({
        where: {
          id: stateRecord.id
        }
      });

      const message = error instanceof Error ? error.message : "Microsoft OAuth failed.";
      return reply.redirect(`${getEnv().DASHBOARD_URL}/mail?error=${encodeURIComponent(message)}`);
    }
  });
}
