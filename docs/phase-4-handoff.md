# Phase 4 Handoff

## Label

`Phase 4: Workspace Polish + Model Settings`

## Why this phase exists

This phase is the bridge between:

- a working local-first mailbox intelligence product
- and a polished AI email client in the direction of Superhuman, Fyxer, and Shortwave

The product should not drift back toward being just a mailbox viewer or just an API integration demo.

## Current product intent

The active product target is:

- a Superhuman-style desktop email experience
- deterministic mailbox intelligence first
- assistant workflows on top of structured data
- configurable model-source routing through a first-class `Settings` area

## Non-negotiable goals

- keep pushing `/mail` toward a Superhuman-like interaction model
- keep the UI keyboard-first and fast-scanning
- preserve deterministic analytics as the source of truth for operational questions
- keep shared mailbox support first-class
- add a real `Settings` surface
- add `Model source for enrichment` as an explicit settings field

## Model-source requirement

The app needs a `Settings -> Models` area with a `Model source for enrichment` field.

That field should support:

- `Local provider`
  Examples:
  - `Ollama`
  - `LM Studio`
  - any local OpenAI-compatible endpoint
- `Cloud API token`
  Examples:
  - OpenAI API
  - Groq API
  - Anthropic API
  - OpenRouter
- `OAuth-connected assistant`
  Examples:
  - `ChatGPT`
  - `Codex`
  - future OAuth-based assistant products

The user should be able to configure:

- provider type
- base URL when needed
- API token when needed
- OAuth connection when supported
- default model
- routing mode (`Auto` vs explicit model/provider)

## What the selected model source should affect

- enrichment
- drafting
- summarization
- template suggestions
- voice adaptation
- assistant workflow output

## What it should not affect

- deterministic mailbox analytics
- contact and organization counting
- reply-state storage
- follow-up task persistence
- sync and mailbox ingestion state

## Current UI direction

The current `/mail` work has already been moving toward:

- denser thread lists
- quieter utility chrome
- stronger selected-row to reader connection
- a latest-message-first reader hierarchy
- an inline reply surface
- lighter command-style action cues
- real keyboard navigation for search, left-pane movement, and composer focus

The next likely UI moves are:

1. continue reducing visual weight in the utility bar
2. tighten remaining pill/tag usage
3. improve motion and transition feel for active rows and reply actions
4. add more keyboard-first affordances without making the UI noisy
5. connect saved model routing into more assistant surfaces

## Implemented In This Slice

- `Settings` now exists as a first-class area in the app shell
- `/settings/models`, `/settings/accounts`, and `/settings/workflows` now exist as routed pages
- settings now persist through the local API and database
- `Settings -> Models` now includes `Model source for enrichment`
- `Local provider`, `Cloud API token`, and `OAuth-connected assistant` categories are now supported
- deterministic analytics remain explicitly separate from selected model routing
- `/mail` now turns shortcut hints into real keyboard actions for search, list movement, composer focus, and escape-to-reset behavior
- `/mail` now defaults to a unified queue across imported mailboxes, with explicit `All`, `Personal`, and `Shared` scope controls
- the thread reader now exposes an assistant workbench with routed model context, deterministic thread briefing data, and grounded draft variants
- the reader and command palette now expose first-pass triage actions for read state, archive, follow-up scheduling, and Settings navigation

## Suggested next implementation order

1. continue the Superhuman-style refinement of `/mail`
2. deepen shared mailbox controls inside `Settings -> Accounts`
3. push saved model routing deeper into more assistant and send flows
4. add stronger ownership, follow-up, and send-later workflows for team queues

## Copyable next-chat prompt

```text
Continue from Phase 4: Workspace Polish + Model Settings.

Current product goal:
- Smart Email Client should keep moving toward a Superhuman-style desktop mail client
- deterministic analytics must remain the foundation
- assistant workflows sit on top of structured mailbox intelligence

Please continue autonomously.

What to work on next:
1. Add a first-class Settings area to the app shell
2. Create /settings/models, /settings/accounts, and /settings/workflows
3. In Settings -> Models, add a field called "Model source for enrichment"
4. Support these model-source categories:
   - Local provider: LM Studio, Ollama, and compatible local endpoints
   - Cloud API token: OpenAI API, Groq API, Anthropic API, OpenRouter, etc.
   - OAuth-connected assistant: ChatGPT / Codex or similar when feasible
5. Preserve the rule that deterministic analytics do not depend on the selected model
6. Keep refining /mail toward a Superhuman-like interaction model while adding Settings

When making product decisions, optimize for:
- keyboard-first speed
- clean modern desktop UX
- shared mailbox support
- deterministic intelligence first
- model routing as a first-class product setting

Please update docs as needed, implement the next slice, verify with typecheck/build, commit, and push to origin/main.
```
