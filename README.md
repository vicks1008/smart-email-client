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

4. Review the MVP architecture:

- [docs/standalone-local-smart-email-client-mvp.md](docs/standalone-local-smart-email-client-mvp.md)

## Current Status

This project is scaffolded for Phase 1 planning and local infrastructure. App implementation still needs to be built.

