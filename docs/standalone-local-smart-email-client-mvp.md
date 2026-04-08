# Standalone Local Smart Email Client MVP

This project is scoped around these constraints:

- standalone local app
- Apple Mail plus Outlook / Office365 support
- shared mailbox visibility
- zero required LLM API spend
- deterministic analytics first
- optional provider routing through Ollama, Groq, and OpenAI
- prompt-based actions, reports, drafting, and follow-ups
- proactive follow-ups and scheduled jobs

## Product Shape

Build a local-first AI email copilot, not just a mailbox viewer. The product target is the practical core of Fyxer, Shortwave, and Superhuman:

- fast inbox triage
- client and contact intelligence
- follow-up awareness
- high-quality drafting in the user's voice
- mailbox analytics over time
- eventually read, write, and send workflows

Build it with three top-level services:

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
- draft replies and reusable email templates
- importance, category, and follow-up classification
- scheduled digests and reports
- proactive prompts on stale or urgent threads
- shared mailbox visibility and ownership workflows
- organization and contact graph building
- activity analytics such as "most active clients in the last 4 months"

## Non-Negotiable Product Requirements

These requirements should remain explicit across future phases:

- `Read`: inbox, sent, and shared mailbox ingestion
- `Write`: read/unread, categorization, archive, move, and other mailbox-state actions
- `Send`: support draft-send or direct send flows once auth is stable
- `Shared mailboxes`: especially team inboxes such as `hey@razzinteractive.com`
- `Client intelligence`: learn organizations, contacts, domains, and likely roles
- `Follow-up intelligence`: know when we owe a reply, when we are waiting, and when to follow up
- `Voice learning`: learn how the user writes from sent mail
- `Template library`: detect repeatable responses and promote them into templates
- `Analytics first`: answer operational questions from structured data before involving a model

## Intelligence Strategy

Use a layered approach:

1. `Mailbox layer`
   Apple Mail, Microsoft Graph, Thunderbird, and archive import
2. `Deterministic intelligence layer`
   organizations, contacts, categories, reply-state, follow-up tasks, and activity analytics
3. `Model layer`
   natural-language summaries, drafting, template suggestions, and voice adaptation

This means:

- questions like "what clients have been most active in the last 4 months?" should be answered from analytics
- models should explain or summarize the answer, not invent it
- drafting should pull from structured thread context plus historical sent-mail examples

## Local Model Strategy

Recommended provider strategy:

- `OpenAI GPT-5.4` for highest-quality reasoning and drafting
- `Groq` for fast hosted open-weight inference
- `Ollama` for truly local models without API spend

Recommended local model tiers:

- `qwen2.5:7b` for fast text triage
- `qwen2.5-vl:7b` for attachments and multimodal work
- `llama3.2-vision:11b` as a second local vision option
- `gpt-oss:20b` for heavier reasoning

Routing modes:

- `Auto`
- forced manual model selection

The provider/model selector should be exposed in the product once the deterministic analytics path is stable.

## Initial API Surface

```text
/v1/auth/microsoft/*
/v1/analytics/organizations/activity
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
/mail/analytics
/automations
/settings/models
/settings/accounts
```

## Phase Order

1. mailbox ingestion and normalization
2. organization, contact, category, reply-state, and follow-up intelligence
3. deterministic analytics and workbench views
4. natural-language query routing over structured data
5. drafting, template mining, and voice learning
6. write/send workflows and polished assistant UX

## Current Direction

The next decisions in this repo should preserve these principles:

- do not regress into read-only mailbox tooling
- keep Apple Mail viable as the zero-admin local live source on macOS
- shared mailbox support remains first-class
- deterministic analytics are the foundation for assistant behavior
- model providers are layered on top of a trustworthy mailbox graph
