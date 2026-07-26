# Slack AI Agent

> Automated Slack onboarding assistant. When someone joins your workspace or a
> monitored channel, it researches them, scores how well they fit your product
> with an LLM, stores the analysis in PostgreSQL, and posts a report card to a
> Slack channel.

Built with Node.js, the Slack Bolt SDK (Socket Mode), LangChain + OpenAI,
Express, and PostgreSQL.

[![CI](https://github.com/Arya-79/Slack_AI_Agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Arya-79/Slack_AI_Agent/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![License](https://img.shields.io/badge/license-ISC-blue)

---

## Contents

- [Demo](#demo)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running](#running)
- [Configuration](#configuration)
- [Slack commands](#slack-commands)
- [HTTP API](#http-api)
- [Testing & quality](#testing--quality)
- [Deployment](#deployment)
- [Data & privacy](#data--privacy)
- [Troubleshooting](#troubleshooting)

---

## Demo

A new member joins → the bot pulls their profile, researches them, scores product
fit with an LLM, **posts a report card to Slack**, and **saves every run to Postgres**.

### ▶️ Watch it run

![Slack AI Agent demo — a new member is analyzed and a report card is posted to Slack](SCREENSHOTS/demo.gif)

<sub>Higher quality: <a href="SCREENSHOTS/demo.mp4">watch the MP4 →</a></sub>

**The analysis card in Slack** — fit score, insights, and recommendations, colour-coded by score:

![Slack analysis card posted to #private1](SCREENSHOTS/OUTPUT1.png)

**Every analysis persisted in PostgreSQL** (`member_analyses`):

![member_analyses table in PostgreSQL](SCREENSHOTS/DB%201.png)

**End-to-end flow** — join event → profile → research (company + GitHub) → LLM → database → Slack:

![End-to-end workflow](SCREENSHOTS/WORKFLOW.png)

### Run it in 2 minutes

The whole flow needs a Slack app, an LLM key (a **free Groq key** works — no card),
and Postgres. The fastest local path (throwaway Docker Postgres — no cloud DB required):

```bash
# 1. Start a local Postgres (data persists in a named volume)
docker run --name slack-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=slackdb \
  -p 5432:5432 -v slack-pg-data:/var/lib/postgresql/data -d postgres:16

# 2. Configure. Fill in Slack, your LLM key (LLM_PROVIDER=groq + GROQ_API_KEY is
#    free), and for the local Postgres above set:
#    DATABASE_URL=postgresql://postgres:postgres@localhost:5432/slackdb
#    DATABASE_SSL=false
cp .env.example .env

# 3. Install, verify the DB, and run
npm install
npm run db:check        # expect: ✅ Connected
npm run dev             # expect: agent_ready ⚡️ Slack AI Agent is running
```

Trigger an analysis without waiting for a real join, then see the card in Slack and the stored row:

```bash
curl -XPOST localhost:3000/test/analyze-member -H 'Content-Type: application/json' \
  -d '{"memberInfo":{"id":"U123","name":"Ada Lovelace","email":"ada@stripe.com","title":"CTO"}}'

curl localhost:3000/api/stats
```

---

## How it works

1. A member joins the workspace (`team_join`) or a public channel
   (`member_joined_channel`).
2. The bot fetches their Slack profile (name, email, title, timezone).
3. If they used a **work** email, it runs best-effort research:
   - the company homepage `<title>` (behind an SSRF guard), and
   - a GitHub search by name, clearly labelled as an _unverified possible match_.
4. Profile + research go to the LLM, which returns a **fit score (0–100)**,
   **insights**, and **recommendations** as strict JSON.
5. The analysis is saved to PostgreSQL.
6. A colour-coded report card is posted to your Slack channel.

**De-duplication:** a member who joins several channels at once is analyzed
once. Repeat joins inside `DEDUPE_WINDOW_HOURS` are skipped.

---

## Architecture

```
 Slack event                 ┌──────────────────────────────┐
 (team_join /  ───────────▶  │  src/slack/events.js         │
  member_joined_channel)     │  (dedupe → getUserInfo)      │
                             └───────────────┬──────────────┘
                                             ▼
                             ┌──────────────────────────────┐
                             │  src/pipeline.js             │
                             │  research → analyze → save   │
                             │  → post → mark-sent          │
                             └───┬───────────┬───────────┬──┘
                    research/    │           │ ai/       │ slack/report.js
                    (company,    ▼           ▼ analyzer  ▼ (Block Kit card)
                     github) ─▶ [web]   OpenAI (LLM) ─▶ Slack channel
                                             │
                                             ▼
                                     PostgreSQL (member_analyses)

 Express (src/server.js): GET /health · read-only admin API (/api/*)
```

---

## Project structure

```
.
├── index.js                  # entry point: construct agent, wire signals, start
├── src/
│   ├── agent.js              # composition root — wires real deps into pure modules
│   ├── config.js             # env loading + validation (fails fast on boot)
│   ├── logger.js             # leveled logger (errors → stderr)
│   ├── db.js                 # Postgres pool + all queries (parameterized)
│   ├── pipeline.js           # research → analyze → persist → post
│   ├── server.js             # Express: health, admin API, dev test endpoint
│   ├── ai/
│   │   └── analyzer.js       # LLM call with retry, tolerant JSON parsing, clamping
│   ├── research/
│   │   ├── index.js          # research orchestration
│   │   ├── company.js        # company homepage lookup + email helpers
│   │   ├── github.js         # GitHub-by-name lookup (labelled unverified)
│   │   └── netguard.js       # SSRF guard (blocks private/reserved addresses)
│   └── slack/
│       ├── events.js         # Slack event handlers
│       ├── report.js         # Block Kit report builder (pure)
│       └── users.js          # users.info fetch + pure field mapping
├── test/                     # node:test unit + integration tests
├── Dockerfile                # multi-stage, non-root, healthcheck
├── eslint.config.js          # ESLint flat config
└── .github/workflows/ci.yml  # lint + format + test on push/PR
```

The Slack/OpenAI/DB modules are injected into otherwise **pure** functions, so
the analysis, report layout, config validation, and SSRF guard are all unit
tested without a live connection.

---

## Prerequisites

- **Node.js ≥ 20**
- A **PostgreSQL** database (e.g. Render, Supabase, or local)
- A **Slack app** with Socket Mode enabled
- An **LLM key** — one of: [OpenAI](https://platform.openai.com/api-keys) (paid),
  [Groq](https://console.groq.com/keys) (**free, no credit card**), or a local
  [Ollama](https://ollama.com) install (no key). Set `LLM_PROVIDER` accordingly.

### Slack app configuration

| Setting             | Value                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Socket Mode         | Enabled (needs an app-level token with `connections:write`)                 |
| Event subscriptions | `team_join`, `member_joined_channel`                                        |
| Slash command       | `/analyze` (optional — see [Slack commands](#slack-commands))               |
| Bot OAuth scopes    | `users:read`, `users:read.email`, `chat:write`, `channels:read`, `commands` |

Invite the bot to the channel it should post to, and copy that channel's ID
into `SLACK_PRIVATE_CHANNEL_ID`.

---

## Setup

```bash
git clone <repository-url>
cd slack_AI_Agent
npm install
cp .env.example .env   # then fill in the values
```

The database table is created automatically on first start
(`CREATE TABLE IF NOT EXISTS member_analyses …`), so there is no manual
migration step.

---

## Running

```bash
npm start        # production
npm run dev      # watch mode + NODE_ENV=development (enables the dev endpoint)
```

On a good start you'll see:

```
… [INFO] database_schema_ready
… [INFO] http_listening { port: 3000 }
… [INFO] slack_connected
… [INFO] agent_ready ⚡️ Slack AI Agent is running
```

If required configuration is missing, the app **exits immediately** and lists
every missing variable at once instead of crashing later:

```
✖ Invalid configuration — fix these and restart:
  • Missing required environment variable: SLACK_BOT_TOKEN
  …
```

---

## Configuration

All variables are read in [`src/config.js`](src/config.js). Required ones are
validated at startup.

| Variable                      | Required | Default        | Description                                                           |
| ----------------------------- | :------: | -------------- | --------------------------------------------------------------------- |
| `SLACK_BOT_TOKEN`             |   yes    | —              | Bot token (`xoxb-…`)                                                  |
| `SLACK_APP_TOKEN`             |   yes    | —              | App-level token (`xapp-…`) for Socket Mode                            |
| `SLACK_SIGNING_SECRET`        |   yes    | —              | App signing secret                                                    |
| `SLACK_PRIVATE_CHANNEL_ID`    |   yes    | —              | Channel the report is posted to                                       |
| `DATABASE_URL`                |   yes    | —              | PostgreSQL connection string                                          |
| `LLM_PROVIDER`                |    no    | `openai`       | `openai` \| `groq` (free) \| `ollama` (local)                         |
| `OPENAI_API_KEY`              |  cond.   | —              | Required when `LLM_PROVIDER=openai`                                   |
| `GROQ_API_KEY`                |  cond.   | —              | Required when `LLM_PROVIDER=groq` (free, no card)                     |
| `LLM_MODEL`                   |    no    | per-provider   | Override the model (defaults: gpt-4o-mini / llama-3.3-70b / llama3.1) |
| `LLM_TEMPERATURE`             |    no    | `0.3`          | Sampling temperature (0–2)                                            |
| `LLM_MAX_RETRIES`             |    no    | `3`            | Retry attempts on transient LLM failures                              |
| `OLLAMA_BASE_URL`             |    no    | `…:11434/v1`   | Ollama endpoint (only for `LLM_PROVIDER=ollama`)                      |
| `DATABASE_SSL`                |    no    | `true`         | Set `false` for a locally-trusted DB without TLS                      |
| `DATABASE_POOL_MAX`           |    no    | `10`           | Max pooled connections                                                |
| `COMPANY_NAME`                |    no    | `Your Company` | Used in the fit-analysis prompt                                       |
| `COMPANY_PRODUCT`             |    no    | `Your Product` | Used in the fit-analysis prompt                                       |
| `RESEARCH_ENABLED`            |    no    | `true`         | Toggle company/GitHub research                                        |
| `DEDUPE_WINDOW_HOURS`         |    no    | `24`           | Skip re-analysis of a member seen within this window                  |
| `RESEARCH_HTTP_TIMEOUT_MS`    |    no    | `5000`         | Timeout for research HTTP calls                                       |
| `RESEARCH_MAX_RESPONSE_BYTES` |    no    | `524288`       | Cap on bytes read from a company site                                 |
| `PORT`                        |    no    | `3000`         | HTTP server port                                                      |
| `NODE_ENV`                    |    no    | `production`   | `development` enables the dev test endpoint                           |
| `LOG_LEVEL`                   |    no    | `info`         | `debug` \| `info` \| `warn` \| `error`                                |
| `ADMIN_API_KEY`               |    no    | —              | If set, the admin API requires this in an `X-API-Key` header          |

---

## Slack commands

Trigger an analysis on demand from inside Slack — no terminal needed:

```
/analyze @user      → analyze a specific member
/analyze            → analyze yourself
```

The bot runs the full pipeline and posts the report card into the channel where
you ran the command (falling back to `SLACK_PRIVATE_CHANNEL_ID` if it isn't a
member there). This is the cleanest way to demo the project live.

**One-time setup** (in your app at api.slack.com/apps):

1. **Slash Commands → Create New Command**
   - Command: `/analyze`
   - Short description: `Analyze a member's product fit`
   - Usage hint: `[@user]`
   - Check **"Escape channels, users, and links sent to your app"** — this makes
     `@user` arrive as an ID the bot can resolve.
   - With Socket Mode on, no Request URL is required.
2. **Reinstall the app** to the workspace when prompted (this grants the
   `commands` scope), then restart the bot.

Works over Socket Mode, so no public URL or hosting is needed.

## HTTP API

The Express server exposes a health check and a **read-only admin API** so the
stored analyses are inspectable, not just a write-only sink.

### `GET /health`

```json
{ "status": "healthy", "service": "slack-ai-agent", "timestamp": "…" }
```

### `GET /api/stats`

```json
{
  "total": 42,
  "sentToSlack": 41,
  "avgFitScore": 63,
  "distribution": { "hot": 8, "warm": 15, "lukewarm": 12, "cold": 7 },
  "lastAnalyzedAt": "2025-01-15T10:30:00.000Z"
}
```

### `GET /api/analyses?limit=20&offset=0`

Paginated list, newest first: `{ items, total, limit, offset }`.

### `GET /api/analyses/:id`

A single analysis, or `404`.

When `ADMIN_API_KEY` is set, `/api/*` requires a matching `X-API-Key` header:

```bash
curl -H "X-API-Key: $ADMIN_API_KEY" http://localhost:3000/api/stats
```

### `POST /test/analyze-member` _(development only)_

Trigger the pipeline manually without waiting for a Slack event:

```bash
curl -XPOST http://localhost:3000/test/analyze-member \
  -H 'Content-Type: application/json' \
  -d '{"memberInfo":{"id":"U1","name":"Ada Lovelace","email":"ada@acme.io","title":"CTO"}}'
```

---

## Testing & quality

```bash
npm test            # node:test suite (no DB or network required)
npm run lint        # ESLint
npm run format      # Prettier (write)
npm run check       # lint + format:check + test
```

CI runs `lint → format:check → test` on every push and pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

---

## Deployment

A multi-stage [`Dockerfile`](Dockerfile) builds a slim, non-root image with a
health check:

```bash
docker build -t slack-ai-agent .
docker run --env-file .env -p 3000:3000 slack-ai-agent
```

Because it uses Socket Mode, there is no inbound Slack webhook to expose — the
container only needs outbound network access.

---

## Data & privacy

This app stores **personal data** (names, emails, job titles) in PostgreSQL and
sends member profile fields to OpenAI for analysis. Before running it against a
real workspace:

- confirm you have a lawful basis and any required notice/consent to profile
  members this way;
- restrict access to the database and the admin API (`ADMIN_API_KEY`);
- treat the GitHub match as a **guess** — it is labelled unverified for that
  reason and should not be acted on as fact.

Profile and research text is passed to the LLM as clearly-delimited untrusted
data, and the model is instructed to ignore any instructions embedded in it.

---

## Troubleshooting

| Symptom                      | Check                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Exits with a config error    | Fill in every variable it lists; see [`.env.example`](.env.example)                         |
| Slack events not received    | Socket Mode on, app installed, events subscribed, scopes granted                            |
| Nothing posted on join       | Bot is a member of `SLACK_PRIVATE_CHANNEL_ID`; check `chat:write`                           |
| Report always shows degraded | The LLM call failed — check your provider key (`GROQ_API_KEY` / `OPENAI_API_KEY`) and quota |
| DB connection failed         | `DATABASE_URL` correct and reachable; `DATABASE_SSL` matches provider                       |

---

## Author

**Arya Chimurkar** — Slack AI Agent. Licensed under [ISC](LICENSE).
