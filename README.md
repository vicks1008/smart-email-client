# Smart Email Client

Standalone local smart email client for Outlook / Office365 with:

- local-first Docker Compose stack
- Microsoft Graph mailbox sync
- shared mailbox visibility
- local LLM routing through Ollama
- prompt-driven actions, reports, drafting, and follow-ups
- background cron-style jobs

## Workspace Layout

```text
apps/
  dashboard-web
  api-server
  mail-worker

docs/
  standalone-local-smart-email-client-mvp.md

infra/local/
  docker-compose.yml
  localstack.env.example
```

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Create the local env file:

```bash
cp infra/local/localstack.env.example .env.localstack
```

3. Start the local stack:

```bash
pnpm local:up
```

4. Copy the app env template:

```bash
cp .env.example .env
```

5. Generate Prisma client and run the initial migration:

```bash
pnpm db:generate
pnpm db:migrate --name init
```

6. Start the Phase 1 apps:

```bash
pnpm --filter @smart-email/api-server dev
pnpm --filter @smart-email/mail-worker dev
pnpm --filter @smart-email/dashboard-web dev
```

7. Review the MVP architecture:

- [docs/standalone-local-smart-email-client-mvp.md](docs/standalone-local-smart-email-client-mvp.md)

## Current Status

Phase 1 foundation is now in place:

- Prisma mail schema shared through `packages/core`
- Fastify API with Microsoft OAuth callback flow, account/mailbox endpoints, and thread APIs
- polling mail worker that queues and executes inbox sync jobs
- initial Next.js `/mail` split-view UI with connect, sync, and shared mailbox controls

Shared mailbox discovery is manual in this first implementation. The UI supports adding a shared mailbox address under an authenticated Microsoft account, then syncing that mailbox through Graph using `/users/{mailbox}`.
