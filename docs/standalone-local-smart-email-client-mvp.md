# Standalone Local Smart Email Client MVP

This project is scoped around these constraints:

- standalone local app
- Outlook / Office365 support
- shared mailbox visibility
- zero required LLM API spend
- local model routing through Ollama
- prompt-based actions, reports, and drafting
- proactive follow-ups and scheduled jobs

## Product Shape

Build a local-first web app with three top-level services:

- `apps/dashboard-web`
- `apps/api-server`
- `apps/mail-worker`

Supporting infrastructure:

- `postgres`
- `redis`
- `minio`
- `ollama`

## Core Features

- ask questions over mailbox history
- draft replies
- importance and follow-up classification
- scheduled digests and reports
- proactive prompts on stale or urgent threads
- shared mailbox visibility and ownership workflows

## Local Model Strategy

Recommended model tiers:

- `qwen2.5:7b` for fast text triage
- `qwen2.5-vl:7b` for attachments and multimodal work
- `llama3.2-vision:11b` as a second local vision option
- `gpt-oss:20b` for heavier reasoning

Routing modes:

- `Auto`
- forced manual model selection

## Initial API Surface

```text
/v1/auth/microsoft/*
/v1/mail/accounts
/v1/mailboxes
/v1/threads
/v1/messages
/v1/prompts/run
/v1/model-providers
/v1/follow-ups
/v1/reports
```

## Initial UI Areas

```text
/mail
/mail/shared
/automations
/settings/models
/settings/accounts
```

## Phase Order

1. Prisma mail schema
2. Microsoft OAuth and mailbox discovery
3. mail-worker polling and cron jobs
4. `/mail` split-view UI
5. model picker and auto-routing UI
6. attachment ingestion and multimodal analysis

