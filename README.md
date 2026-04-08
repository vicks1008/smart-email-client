# Smart Email Client

Local-first AI email copilot for Mail.app, Outlook / Office365, and imported archives, aimed at the practical core of tools like Fyxer, Shortwave, and Superhuman:

- read and sync personal plus shared mailboxes
- update mailbox state such as read/unread, triage, archive, and categorization
- draft and eventually send replies in the user's voice
- surface overdue replies, stale threads, and follow-up prompts
- learn clients, organizations, and points of contact from historical mail
- answer mailbox questions with deterministic analytics first, then model-assisted summaries
- run background sync and follow-up jobs

## Product Direction

The product is not just a mailbox viewer. The long-term goal is an AI-assisted email workspace with four layers:

- `Mailbox access`: Apple Mail, Microsoft Graph, Thunderbird, or archive ingestion
- `Deterministic intelligence`: organizations, contacts, reply-state, follow-up timing, and activity analytics
- `Assistant workflows`: drafting, templates, voice learning, and thread insights
- `Provider routing`: OpenAI for frontier reasoning, Groq for fast hosted open-weight inference, and Ollama for truly local models

This ordering matters:

- deterministic data and analytics come first
- model output explains, drafts, or routes on top of structured facts
- the app should never need an LLM to answer simple operational questions like "who were the most active clients in the last 4 months?"

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

The app is currently in an early Phase 2 state:

- shared mail, contact, organization, category, reply-state, and follow-up data models are in place
- Microsoft OAuth callback flow exists for direct Graph-based mailbox access
- Apple Mail now drives the recommended live mailbox view on macOS
- Thunderbird MCP remains available as a legacy local live-mail source
- Outlook MCP remains available as a fallback bridge when Mail.app is not viable
- archive import remains available for `.olm` and `.eml`
- the `/mail` workspace now includes inbox, accounts, follow-ups, live mail, and analytics views
- organization activity analytics now support questions like "which clients were most active in the last 4 months?"

Shared mailbox workflows are still incomplete and should be treated as in-progress. For Microsoft Graph, shared mailbox behavior depends on delegated mailbox access plus the correct `Shared` Graph permissions.

## Required Capabilities

The persistent product target for this repo includes:

- personal mailbox sync
- shared mailbox sync, especially team mailboxes like `hey@razzinteractive.com`
- read/write mailbox actions
- send or draft-send workflows
- auto categorization
- client and contact graph building
- follow-up detection and reminders
- voice learning from sent mail
- template mining and template library support
- analytics over historical activity
- natural-language questions over structured mailbox data

## Ingestion Strategy

The app currently supports multiple ways to get mail into the same intelligence layer:

- Microsoft OAuth and Graph for first-party mailbox access
- Apple Mail live access through Mail.app Automation on macOS
- Outlook MCP auth-sidecar plus Graph-backed live browsing on localhost
- Thunderbird MCP for local live mailbox access
- Outlook archive import via `.olm`
- targeted `.eml` import for recovery or testing

On macOS, Apple Mail is now the most practical zero-admin live source. First-party Microsoft Graph remains the cleanest long-term architecture when tenant approval is available, while Outlook MCP, Thunderbird, and archive import remain fallbacks.

## Apple Mail Live Source

The app now supports a local Apple Mail live route by reading Mail.app on this Mac through Automation. This avoids Azure consent and Outlook Web scraping while preserving the same `/mail` workspace structure.

Local setup on this machine:

```bash
git clone https://github.com/s-morgan-jeffries/apple-mail-mcp.git tools/apple-mail-mcp
uv --directory tools/apple-mail-mcp sync --dev
```

Live-source requirements for this route:

- Mail.app configured with the mailbox already working locally
- macOS Automation permission granted to the terminal or app running Smart Email Client
- `APPLE_MAIL_TIMEOUT_SECONDS` optionally tuned in `.env` for slower mailboxes

On first access, macOS may prompt for:

- `System Settings` -> `Privacy & Security` -> `Automation`
- allow your terminal or desktop app to control `Mail`

Then open `/mail` and use `Refresh live`. If Mail.app is open and syncing, the live workspace should populate without a separate sign-in helper.

The upstream `apple-mail-mcp` repo is bundled locally in `tools/apple-mail-mcp`, but the app currently uses the in-repo Apple Mail adapter for live browse/read because it is more stable than the upstream mailbox listing/search output for this MVP slice.

## Outlook MCP Live Source

Outlook MCP remains available as a Graph-backed fallback when Mail.app is not a fit and direct Microsoft Graph callback approval is blocked.

## Thunderbird Live Source

Thunderbird remains a useful local live source through the MCP extension. The app talks directly to Thunderbird's localhost JSON-RPC endpoint on `8765`, which can be valuable when a mailbox is already working in Thunderbird and direct Graph access is not yet configured.

Local setup on this machine:

```bash
git clone https://github.com/TKasperczyk/thunderbird-mcp.git tools/thunderbird-mcp
```

Then install the bundled XPI from:

```text
tools/thunderbird-mcp/dist/thunderbird-mcp.xpi
```

After installing the extension in Thunderbird, restart Thunderbird and reload `/mail`.

`.olm` extraction uses a small local Python bridge. Clone the converter locally when you want archive import enabled:

```bash
mkdir -p tools
git clone https://github.com/PeterWarrington/olm-convert.git tools/olm-convert
```

If the converter lives on a non-default Python interpreter, set `OLM_CONVERTER_PYTHON` in `.env`.

## Documentation Anchor

When making product decisions in this repo, optimize for:

- deterministic analytics before model usage
- read/write/send mailbox support, not read-only tooling
- shared mailbox support as a first-class requirement
- a real AI email workspace, not just sync infrastructure
