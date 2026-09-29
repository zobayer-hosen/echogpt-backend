# EchoGPT Backend

REST API for **EchoGPT**, a multi-AI Chrome extension: chat with several AI models (ChatGPT, Claude, Gemini) and run AI-assisted web searches from a browser side panel.

It handles secure login that survives browser restarts, Free/Premium plans with daily limits, one chat and search API over many AI providers (keys encrypted, never exposed), conversation and search history, and admin APIs for users, plans, providers, analytics, logs and health.

> **Works without paid keys.** A free **Mock AI** provider is seeded as the default, so every endpoint works out of the box. Admins can add OpenAI, Anthropic or Gemini keys at any time.

| | |
|---|---|
| **Swagger UI** | http://localhost:3000/api/docs (OpenAPI JSON: `/api/docs-json`) |
| **Base path** | `http://localhost:3000/api/v1` |
| **Specs** | [PRD](docs/PRD.md) · [ERD](docs/ERD.md) · [Architecture](docs/ARCHITECTURE.md) · [Decisions](docs/DECISIONS.md) · [AI log](docs/AI_LOG.md) |
| **Postman** | [`postman/EchoGPT.postman_collection.json`](postman/EchoGPT.postman_collection.json) |

---

## Contents

1. [Tech stack](#tech-stack)
2. [Architecture](#architecture)
3. [Database](#database)
4. [Getting started (local PostgreSQL)](#getting-started-local-postgresql)
5. [Environment variables](#environment-variables)
6. [Scripts](#scripts)
7. [Demo accounts](#demo-accounts)
8. [Try it in 1 minute](#try-it-in-1-minute)
9. [API overview](#api-overview)
10. [Errors](#errors)
11. [Using real AI providers](#using-real-ai-providers)
12. [Tests](#tests)
13. [Design decisions](#design-decisions)
14. [Limitations and future work](#limitations-and-future-work)
15. [Project structure](#project-structure)

---

## Tech stack

| Choice | Why |
|---|---|
| **NestJS 11** (TypeScript) | Modules, DI, guards, pipes and interceptors fit a layered API; first-class Swagger. Nest 11 (CommonJS) keeps Jest working (see [D5](docs/DECISIONS.md)). |
| **PostgreSQL 16+** (local, no Docker) | Partial unique indexes, CHECK constraints, row locks for the atomic usage counter, JSONB for search results. |
| **TypeORM 0.3** + migrations | Entities mirror the ERD; `synchronize: false`, schema changes only via migrations. |
| **JWT** (access + rotating refresh) + DB sessions | Short-lived access tokens, refresh rotation with reuse detection, real logout. |
| **bcrypt** (cost 10) | Password hashing. |
| **AES-256-GCM** (Node `crypto`) | Provider API keys encrypted at rest. |
| **class-validator** | Every DTO validated; unknown fields rejected. |
| **Swagger (OpenAPI 3)** | Every endpoint documented with examples and every error response. |
| **Plain `fetch`** | Provider adapters with no SDK lock-in, 30 s timeout. |
| **Jest + supertest** | Unit tests next to the code, e2e tests against a real test database. |
| **helmet, CORS allow-list, @nestjs/throttler** | Security headers, extension origins, 60 req/min per IP and 5 logins/min. |

## Architecture

```mermaid
graph LR
  Ext[Chrome extension] -->|HTTPS + Bearer JWT| API
  subgraph API[NestJS API /api/v1]
    Auth[auth] --- Users[users]
    Users --- Subs[subscriptions]
    Chat[chat] --> Subs
    Chat --> Prov[providers]
    Search[search] --> Subs
    Search --> Prov
    Admin[admin] -.reads.-> Users & Subs & Chat & Search & Prov
  end
  Prov -->|fetch| OpenAI & Anthropic & Gemini
  Prov --> Mock[Mock AI]
  API --> PG[(PostgreSQL)]
```

- One module per business area; each owns its tables and exports a service ([PRD §10](docs/PRD.md#10-project-structure)).
- Global pipeline: request id → rate limit → JWT guard (checks the DB session) → roles guard → validation → controller → service → one error filter → request log row.
- Provider-specific code lives only in `src/modules/providers/adapters/`.

Details, diagrams and the request lifecycle: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Database

9 tables, 5 enums. Full design in **[docs/ERD.md](docs/ERD.md)**.

![ERD](docs/ERD.png)

Rules the database enforces itself: unique email among non-deleted users, one subscription per user, one default provider (which must be enabled), `requests_used >= 0`, and the daily limit (one atomic `UPDATE`).

## Getting started (local PostgreSQL)

### 1. Prerequisites

- **Node.js 20+** (developed on Node 24) and npm
- **PostgreSQL 16+** running locally (developed on 18; nothing newer than 16 is used)

### 2. Create the databases

`echogpt` for the app and `echogpt_test` for the e2e tests.

```bash
# macOS / Linux
createdb -U postgres echogpt
createdb -U postgres echogpt_test
```

```powershell
# Windows (PowerShell); adjust the version folder if needed
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres echogpt
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres echogpt_test
```

Or in `psql`: `CREATE DATABASE echogpt; CREATE DATABASE echogpt_test;`

### 3. Install and configure

```bash
git clone https://github.com/zobayer-hosen/echogpt-backend.git
cd echogpt-backend
npm ci
cp .env.example .env        # Windows: copy .env.example .env
```

Edit `.env`:

- `DATABASE_URL`: your local Postgres user and password, e.g. `postgresql://postgres:<password>@localhost:5432/echogpt`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`: two different random strings (≥ 32 chars)
- `ENCRYPTION_KEY`: 64 hex characters

Generate the secrets with:

```bash
node -e "const c=require('crypto');console.log('JWT_ACCESS_SECRET='+c.randomBytes(48).toString('base64url'));console.log('JWT_REFRESH_SECRET='+c.randomBytes(48).toString('base64url'));console.log('ENCRYPTION_KEY='+c.randomBytes(32).toString('hex'))"
```

The app **refuses to start** if a required value is missing or invalid, and the error names the variable, never its value.

### 4. Migrate, seed, run

```bash
npm run migration:run   # creates the 9 tables
npm run seed            # roles, demo users, providers (safe to run again)
npm run start:dev       # http://localhost:3000/api/v1
```

Open **http://localhost:3000/api/docs**.

Production build: `npm run build && npm run migration:run:prod && npm run start:prod`.

## Environment variables

| Variable | Example | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `production` or `test` |
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/echogpt` | Local Postgres |
| `TEST_DATABASE_URL` | *(optional)* | e2e database; default is `DATABASE_URL` with the name `echogpt_test` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | long random strings | Token signing (must differ) |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `15m` / `7d` | Token lifetimes |
| `ENCRYPTION_KEY` | 64 hex chars | AES-256-GCM key for provider API keys |
| `FREE_DAILY_LIMIT` / `PREMIUM_DAILY_LIMIT` | `20` / `500` | Requests per UTC day |
| `CORS_ORIGINS` | `http://localhost:3000,chrome-extension://<id>` | CORS allow-list |
| `SEARCH_CACHE_TTL_SECONDS` | `3600` | Search cache lifetime (`0` disables it) |
| `AI_REQUEST_TIMEOUT_MS` | `30000` | Provider timeout |
| `RATE_LIMIT_PER_MINUTE` / `LOGIN_RATE_LIMIT_PER_MINUTE` | `60` / `5` | Per-IP rate limits |

## Scripts

| Command | What it does |
|---|---|
| `npm run start:dev` | Run with watch mode |
| `npm run build` / `npm run start:prod` | Compile to `dist/` / run the build |
| `npm run migration:run` / `migration:revert` / `migration:show` | Apply / roll back / list migrations |
| `npm run migration:generate -- src/database/migrations/Name` | Generate a migration from entity changes |
| `npm run seed` | Idempotent seed: roles, demo users + plans, providers |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm test` | Unit tests |
| `npm run test:e2e` | e2e tests (uses `echogpt_test`, migrates and re-seeds it) |
| `npm run test:cov` | Unit test coverage |

## Demo accounts

Created by `npm run seed`. **Password for all: `Password123!`** (demo only, do not use in production).

| Email | Role | Plan | Daily limit |
|---|---|---|---|
| `alice@echogpt.dev` | USER | FREE | 20 |
| `bob@echogpt.dev` | USER | PREMIUM | 500 |
| `admin@echogpt.dev` | ADMIN | PREMIUM | 500 |

Seeded providers: **Mock AI** (enabled, default, no key), **OpenAI** `gpt-4o-mini`, **Claude** `claude-haiku-4-5`, **Gemini** `gemini-flash-latest` (all three disabled until an admin adds a key).

## Try it in 1 minute

```bash
BASE=http://localhost:3000/api/v1

# 1. log in as the FREE demo user
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'content-type: application/json' \
  -d '{"email":"alice@echogpt.dev","password":"Password123!"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).accessToken")

# 2. chat (starts a conversation)
curl -s -X POST $BASE/chat/messages -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"prompt":"Give me 3 tips for clear emails"}'

# 3. search, then search again (served from cache)
curl -s -X POST $BASE/search -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"query":"chrome extension security"}'

# 4. remaining requests today
curl -s $BASE/subscriptions/me/usage -H "Authorization: Bearer $TOKEN"
```

Or in Swagger: `POST /auth/login` → **Authorize** → paste the `accessToken` → try any endpoint. In Postman, import the collection and run **Auth → Log in as alice**; tokens and ids are saved into collection variables automatically.

## API overview

🔓 public · 🔑 logged in · 👑 admin. Full details, bodies, examples and every error response are in Swagger.

| Area | Endpoints | Auth |
|---|---|---|
| Health | `GET /health` | 🔓 |
| Auth | `POST /auth/register` · `/login` · `/refresh` · `/verify-email` | 🔓 |
| | `POST /auth/logout` · `/logout-all` · `/resend-verification` | 🔑 |
| Users | `GET` · `PATCH` · `DELETE /users/me` · `PATCH /users/me/password` | 🔑 |
| Plans | `GET /plans` | 🔓 |
| Subscriptions | `GET /subscriptions/me` · `POST /subscriptions/me/change` · `GET /subscriptions/me/usage` | 🔑 |
| Providers | `GET /providers` | 🔑 |
| Chat | `POST /chat/messages` · `POST` · `GET /chat/conversations` · `GET` · `PATCH` · `DELETE /chat/conversations/:id` · `POST /chat/conversations/:id/messages` | 🔑 |
| | `POST /chat/conversations/:id/messages/stream` (SSE: `token` events, then `done`) | 🔑 |
| Search | `POST /search` · `GET` · `DELETE /search/history` · `DELETE /search/history/:id` · `GET /search/recent` · `GET /search/suggestions?q=` | 🔑 |
| Admin | `GET /admin/dashboard` · `GET /admin/health` · `GET /admin/analytics/usage` · `GET /admin/logs/requests` | 👑 |
| | `GET /admin/users` · `GET` · `PATCH` · `DELETE /admin/users/:id` | 👑 |
| | `GET /admin/subscriptions` · `PATCH /admin/subscriptions/:userId` | 👑 |
| | `GET` · `POST /admin/providers` · `PATCH` · `DELETE /admin/providers/:id` · `PATCH …/status` · `PATCH …/default` · `POST …/health-check` · `GET /admin/providers/health` | 👑 |

**Conventions:** JSON with camelCase fields and ISO-8601 UTC times. Lists take `?page=1&limit=20` (max 100) and return `{ data, meta: { page, limit, total, totalPages } }`. Another user's resource returns **404**, so its existence isn't revealed. Every response carries an `x-request-id` header.

**Usage:** every chat message and search counts one request per UTC day (FREE 20, PREMIUM 500). The check and the count are one atomic SQL `UPDATE`. A failed AI call does not count. A cached search still counts.

## Errors

Every error has the same shape:

```json
{
  "statusCode": 429,
  "code": "USAGE_LIMIT_EXCEEDED",
  "message": "Daily limit of 20 requests reached",
  "details": { "limit": 20, "used": 20, "remaining": 0, "resetsAt": "2026-09-30T00:00:00.000Z" },
  "timestamp": "2026-09-29T10:15:00.000Z",
  "path": "/api/v1/search",
  "requestId": "0d9c4e62-3a8e-4b8e-9a53-3f1f0f2f1a11"
}
```

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_ERROR` (fields in `details`), `EMAIL_TOKEN_INVALID` |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `REFRESH_TOKEN_INVALID`, `REFRESH_TOKEN_REUSED` |
| 403 | `FORBIDDEN`, `ACCOUNT_DISABLED` |
| 404 | `NOT_FOUND` |
| 409 | `EMAIL_TAKEN`, `ALREADY_ON_PLAN`, `PROVIDER_IS_DEFAULT`, `PROVIDER_DISABLED`, `PROVIDER_NAME_TAKEN`, `EMAIL_ALREADY_VERIFIED`, `LAST_ADMIN` |
| 429 | `USAGE_LIMIT_EXCEEDED`, `RATE_LIMITED` |
| 500 / 502 / 504 | `INTERNAL_ERROR` (no stack trace), `PROVIDER_ERROR`, `PROVIDER_TIMEOUT` |

## Using real AI providers

1. Log in as `admin@echogpt.dev`.
2. `PATCH /admin/providers/:id` with `{ "apiKey": "<your key>" }` (OpenAI, Claude or Gemini row), then `PATCH /admin/providers/:id/status` with `{ "isEnabled": true }`.
3. `POST /admin/providers/:id/health-check` makes a tiny real call and reports `UP` / `DOWN` with latency.
4. Optionally `PATCH /admin/providers/:id/default` to make it the default.

Keys are encrypted with AES-256-GCM (`ENCRYPTION_KEY`), never returned (only `apiKeyMasked`, e.g. `••••a1b2`) and never logged. Users choose a provider with `providerId` from `GET /providers`, or omit it to use the default.

**Mock provider:** put `[mock-error]` or `[mock-timeout]` in a prompt or query to see `502` / `504` handling (and that the request is not counted).

**Email verification (bonus):** registering creates a one-time token (stored hashed, valid 24 h). In development the "email" is printed to the server console as a `[Mail]` log line; send the token to `POST /auth/verify-email`. `POST /auth/resend-verification` sends a new one (at most once per minute). Verification is not required to use the API.

**Streaming:** `POST /chat/conversations/:id/messages/stream` answers with Server-Sent Events. Try it with `curl -N`:

```bash
curl -N -X POST $BASE/chat/conversations/<id>/messages/stream \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"prompt":"Tell me a story"}'
```

## Tests

```bash
npm test            # unit
npm run test:e2e    # e2e against echogpt_test (runs migrations and re-seeds it each file)
```

e2e tests boot the real app (same `configureApp()` as `main.ts`) against a separate database. They refuse to run against a database whose name doesn't end in `_test`.

| PRD test | Where |
|---|---|
| T1 register → login → `/users/me`; duplicate 409; wrong password 401 | `test/e2e/auth.e2e-spec.ts`, `users.e2e-spec.ts` |
| T2 refresh rotation + reuse revokes the session | `auth.e2e-spec.ts` |
| T3 logout rejects that session's access token | `auth.e2e-spec.ts` |
| T4 USER → `/admin/*` 403, ADMIN 200 | `roles.e2e-spec.ts`, `admin.e2e-spec.ts` |
| T5 21st FREE request → 429, after upgrade allowed | `usage.e2e-spec.ts` (service and HTTP) |
| T6 concurrent requests at limit − 1 → exactly one succeeds | `usage.e2e-spec.ts` |
| T7 chat with MOCK saves both messages; other user's conversation 404 | `chat.e2e-spec.ts` |
| T8 key encrypt/decrypt; no response contains the key | `crypto.util.spec.ts`, `providers.e2e-spec.ts` |
| T9 one default provider; disabling the default 409 | `providers.e2e-spec.ts`, `database.e2e-spec.ts` |
| T10 second identical search `fromCache: true`, provider called once | `search.e2e-spec.ts` |
| T11 adapters map HTTP errors / timeouts to 502 / 504 | `providers/adapters/*.adapter.spec.ts` |

Also covered: schema constraints and seed idempotency (`database.e2e-spec.ts`), error format and request ids (`health.e2e-spec.ts`), and a **Swagger completeness check** (`docs.e2e-spec.ts`): every PRD endpoint is documented with a summary, tag, lock, success response, all relevant error responses and an example for every field.

## Design decisions

The full list with reasons is in **[docs/DECISIONS.md](docs/DECISIONS.md)**. Highlights:

- **Sessions in the DB + JWT**: every request checks its session, so logout and suspension work immediately; refresh tokens rotate with reuse detection.
- **Usage counter in `subscriptions`**, checked and counted in one atomic `UPDATE` (race-free).
- **Plans in config, not a table**: two fixed plans; see ERD §7 for when to change that.
- **Mock provider as default** so the whole API runs without paid keys.
- **Search cache inside `web_searches`**: no extra table; only real answers are reused, for 1 hour.
- **Health checks read the model** (free, real, authenticated call) instead of generating text.
- **NestJS 11 + Jest** instead of the ESM-only NestJS 12 template (Vitest).

## Limitations and future work

- **Payments are simulated**: plan changes are immediate and free.
- **Search is AI-assisted**, not a real web crawl: results come from the model and can be out of date. A real search API (Brave/Tavily) fits behind the same interface.
- **Real providers were not called live** during development (no paid keys). Adapters follow the public API docs and are covered by tests with mocked `fetch`.
- **Rate limits are in memory**, so they apply per instance. Use Redis for exact limits across instances.
- **Quotas count requests**, not tokens or cost per model.
- **Soft delete only**: no hard purge or data export (GDPR) yet.
- No Docker image or CI/CD yet (optional in the brief).

See [PRD §16](docs/PRD.md#16-future-improvements) for the roadmap.

## Project structure

```text
src/
├── main.ts                 # configureApp(): helmet, CORS, ValidationPipe, Swagger, /api/v1
├── app.module.ts           # config, TypeORM, throttler, all modules
├── config/                 # typed config, env validation, Swagger setup
├── common/                 # error codes, plans, decorators, DTOs, enums, filter, guards,
│                           # request logging, request id, crypto/pagination/text utils
├── database/               # data-source (CLI), migrations, seed
└── modules/
    ├── auth/               # register, login, refresh, logout, sessions, JWT strategy
    ├── users/              # /users/me, /admin/users
    ├── subscriptions/      # /plans, /subscriptions/me, /admin/subscriptions, usage counter
    ├── providers/          # /providers, /admin/providers, adapters (OpenAI, Anthropic, Gemini, Mock)
    ├── chat/               # conversations and messages
    ├── search/             # search, history, recent, suggestions, cache
    ├── logging/            # api_usage_logs
    ├── admin/              # dashboard, analytics, request logs, system health
    └── health/             # public GET /health
test/
├── setup/                  # test env, test app, factories
└── e2e/                    # auth, roles, users, usage, subscriptions, chat, providers, search, admin, …
```

## How AI was used

This project was built with Claude Code from the PRD and ERD, one feature branch and PR at a time. What it did, and what review changed, is logged in **[docs/AI_LOG.md](docs/AI_LOG.md)**. The rules it followed are in [CLAUDE.md](CLAUDE.md).
