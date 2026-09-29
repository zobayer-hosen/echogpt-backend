# EchoGPT Backend — Product Requirements Document (PRD)

| | |
|---|---|
| **Product** | EchoGPT backend REST API (for the EchoGPT multi-AI Chrome extension) |
| **Version** | 1.0 |
| **Stack** | NestJS · PostgreSQL 16 · TypeORM · Swagger (OpenAPI 3) · JWT |
| **Runs on** | Node.js LTS + a local PostgreSQL. Docker is optional in the brief and **not used**. |
| **Related** | [ERD.md](./ERD.md) — full database design (9 tables) |

---

## 1. Problem

EchoGPT lets people chat with several AI models (ChatGPT, Claude, Gemini) and run AI-assisted web searches from a browser side panel. The extension needs a backend that:

- knows **who** the user is (secure login that survives browser restarts),
- decides **how much** they may use (Free vs Premium),
- talks to **several AI providers** through one API, without ever exposing API keys,
- remembers **conversations and searches**,
- gives admins **visibility and control** (users, plans, providers, usage, logs, health).

---

## 2. Goals and non-goals

### Goals
1. Secure auth: short-lived access tokens, rotating refresh tokens, real logout.
2. One chat and search API over many providers. Switching provider is a parameter, not new code.
3. Fair usage: per-plan daily limits, enforced atomically and visible to the user.
4. Provider API keys encrypted at rest and never returned.
5. Every endpoint documented in Swagger with examples and error responses.
6. Every HTTP request and every AI call logged for analytics.
7. Runs locally with one Postgres database and a few npm commands.

### Non-goals (v1)
- Real payments (upgrade is simulated).
- The Chrome extension UI.
- Real web crawling (search is AI-assisted through the provider layer).
- Docker (optional in the brief; can be added later).

---

## 3. Users (personas and demo accounts)

| Persona | Demo account | Can do |
|---|---|---|
| **Guest** | — | register, login, see plans, health |
| **Free user** | `alice@echogpt.dev` | chat + search, 20 requests/day |
| **Premium user** | `bob@echogpt.dev` | same, 500 requests/day |
| **Admin** | `admin@echogpt.dev` | everything above + all `/admin` APIs |

Demo password for all: `Password123!` (demo only; the README says so).

---

## 4. Assumptions

| # | Assumption | Reason |
|---|---|---|
| A1 | **No paid AI keys.** Real adapters for OpenAI, Anthropic and Gemini are implemented; a `MOCK` provider (no key) is seeded as default, so the whole API works out of the box. | Evaluators can run everything for free; real providers work as soon as an admin adds a key. |
| A2 | Web search is **AI-assisted**: the provider returns a short answer + a list `{title, url, snippet}`. | The brief says "AI-assisted web search"; no paid search API is needed. |
| A3 | Usage = **chat messages + searches**, counted per **UTC day**. FREE 20/day, PREMIUM 500/day, set in env. | Simple, testable, resets at 00:00 UTC. |
| A4 | Two fixed plans, stored as `plan` on each user's single `subscriptions` row. Upgrade/downgrade is **immediate and simulated**. Downgrading keeps data; if today's usage is already over the new limit, `remaining = 0`. | The brief asks for the API behaviour, not billing. |
| A5 | Access token **15 min**, refresh token **7 days**, refresh **rotates** on every use. | Industry standard for browser extensions. |
| A6 | Delete account = **soft delete** (`deleted_at`), all sessions revoked, email freed. | Keeps analytics consistent; hard purge is future work. |
| A7 | Every new user gets a FREE subscription row at registration. | Every user always has exactly one plan. |
| A8 | A failed AI call does **not** use up quota (the request is given back). | Users shouldn't pay for provider outages. |
| A9 | Email verification (bonus) is **not required** to use the API. Emails are printed to the console in dev. | Keeps the demo runnable without a mail server. |

---

## 5. Features and acceptance criteria

### 5.1 Authentication

| ID | Story | Acceptance criteria |
|---|---|---|
| AU-1 | Register | Valid, unique email (case-insensitive); password ≥ 8 chars with a letter and a digit; full name 2–80 chars. bcrypt hash. Creates user (role USER) + FREE subscription in **one transaction**. Returns user + tokens. Duplicate → `409 EMAIL_TAKEN`. |
| AU-2 | Login | Correct → `{accessToken, refreshToken, expiresIn, user}` and a new `sessions` row. Wrong email **or** password → the same `401 INVALID_CREDENTIALS`. Suspended → `403 ACCOUNT_DISABLED`. Updates `last_login_at`. |
| AU-3 | Refresh token | Valid refresh → new access **and** new refresh token; the old one stops working. Re-using an old one → session revoked, `401 REFRESH_TOKEN_REUSED`. Expired or revoked → `401`. |
| AU-4 | Secure logout | Revokes the current session. After that, **both** the access and the refresh token of that session are rejected (the JWT guard checks the session). |
| AU-5 | Logout all devices | Revokes every active session of the user. |
| AU-6 | Password hashing | bcrypt (cost 10). Hashes are never returned or logged. |
| AU-7 | Email verification (bonus) | Register creates a one-time token (hashed on `users`, 24 h). `POST /auth/verify-email {token}` sets `is_email_verified`. Resend endpoint, max once per minute. |

### 5.2 User management

| ID | Story | Acceptance criteria |
|---|---|---|
| US-1 | View profile | `GET /users/me` → id, email, fullName, avatarUrl, role, isEmailVerified, plan, createdAt. Never the password hash. |
| US-2 | Update profile | Only `fullName` and `avatarUrl`. Unknown fields → `400`. |
| US-3 | Change password | Needs the current password (wrong → `401`). New ≠ old. Revokes all **other** sessions. |
| US-4 | Delete account | Needs the current password. Soft delete, revokes all sessions, `204`. The last ADMIN can't delete themselves (`409 LAST_ADMIN`). |
| US-5 | Roles (Admin/User) | `roles` table. `@Roles('ADMIN')` on every `/admin` route; a USER gets `403 FORBIDDEN`. |

### 5.3 Subscription management

| ID | Story | Acceptance criteria |
|---|---|---|
| SU-1 | Free & Premium plans | `GET /plans` (public) → code, name, dailyLimit, price. |
| SU-2 | Subscription status API | `GET /subscriptions/me` → plan, startedAt, dailyLimit. |
| SU-3 | Upgrade / downgrade | `POST /subscriptions/me/change {plan}`. Same plan → `409 ALREADY_ON_PLAN`. Updates `plan` + `started_at`. |
| SU-4 | Usage limits | Every chat message and search counts **one request**, checked and counted in **one atomic SQL UPDATE** before calling the AI (ERD §3). Limit reached → `429 USAGE_LIMIT_EXCEEDED` with `{limit, used, remaining: 0, resetsAt}`. |
| SU-5 | Remaining requests API | `GET /subscriptions/me/usage` → `{plan, limit, used, remaining, resetsAt}`. Chat and search responses also include `usage.remaining`. |

### 5.4 AI provider management

| ID | Story | Acceptance criteria |
|---|---|---|
| PR-1 | Add provider | Admin sends `name`, `type` (OPENAI / ANTHROPIC / GEMINI / MOCK), `model`, `apiKey` (required unless MOCK). The key is encrypted before saving. |
| PR-2 | Edit provider | Any field. A new `apiKey` replaces the old one; omitting it keeps the current key. |
| PR-3 | Delete provider | Blocked for the default provider (`409 PROVIDER_IS_DEFAULT`). History keeps working (FK `SET NULL`). |
| PR-4 | Enable / disable | Disabled providers can't be used. Disabling the default → `409 PROVIDER_IS_DEFAULT`. |
| PR-5 | Store API keys securely | AES-256-GCM with `ENCRYPTION_KEY` from env. The API **never** returns a key, only `apiKeyMasked` (`••••a1b2`) and `hasApiKey`. Keys are never logged. The app won't start without a valid `ENCRYPTION_KEY`. |
| PR-6 | Default provider selection | `PATCH /admin/providers/:id/default`. Switches in one transaction; the DB allows only one default, and it must be enabled. |
| PR-7 | Health check endpoint | `POST /admin/providers/:id/health-check` makes a tiny real call, saves `UP`/`DOWN` + time, logs it, returns latency. `GET /admin/providers/health` checks all enabled providers. |
| PR-8 | Providers for users | `GET /providers` → enabled providers only: id, name, type, model, isDefault. No key info. |

**Provider layer:** one `AiProviderAdapter` interface (`chat()`, `search()`, `healthCheck()`), four implementations (OpenAI, Anthropic, Gemini, Mock) using plain `fetch`, picked by a factory from `provider.type`. A new provider = one new adapter file. Timeout 30 s. Errors map to `502 PROVIDER_ERROR` / `504 PROVIDER_TIMEOUT`.

### 5.5 Chat

| ID | Story | Acceptance criteria |
|---|---|---|
| CH-1 | Send prompt | `POST /chat/conversations/:id/messages {prompt, providerId?}`: prompt 1–8 000 chars. `POST /chat/conversations {title?}` creates a conversation first; or `POST /chat/messages {prompt}` without an id creates one automatically. |
| CH-2 | Receive AI response | Order: ownership check → count usage → load last 20 messages → call provider → save USER + ASSISTANT messages → log → return `{userMessage, assistantMessage, usage.remaining}`. |
| CH-3 | Provider selection | `providerId` optional → default provider. Disabled → `409 PROVIDER_DISABLED`; unknown → `404`. |
| CH-4 | Conversation history | `GET /chat/conversations` (paginated, newest first), `GET /chat/conversations/:id` (with messages in order), `PATCH` (rename), `DELETE` (soft). Another user's conversation → `404`. |
| CH-5 | Streaming (bonus) | `POST /chat/conversations/:id/messages/stream` → `text/event-stream`: `token` events, then a `done` event with the saved message id and usage. |

### 5.6 Web search

| ID | Story | Acceptance criteria |
|---|---|---|
| WS-1 | Search query | `POST /search {query, providerId?}`: 2–300 chars. Counts usage. Returns `{answer, results[{title,url,snippet}], fromCache, usage.remaining}` and saves the search. |
| WS-2 | Search history | `GET /search/history?page&limit` (own only), `DELETE /search/history/:id`, `DELETE /search/history`. |
| WS-3 | Recent searches | `GET /search/recent` → the last 10 **distinct** queries. |
| WS-4 | Search suggestions | `GET /search/suggestions?q=pre` → up to 8: the user's past queries starting with `q`, then popular recent queries from all users. |
| WS-5 | Result caching (bonus) | Same normalized query + provider within 1 h → answer reused from `web_searches`, `fromCache: true`, provider not called. A cached search still counts as one request. |

### 5.7 Admin panel APIs

| ID | Story | Acceptance criteria |
|---|---|---|
| AD-1 | Dashboard statistics | `GET /admin/dashboard`: total users, new users (7 d), users per plan, requests today, chat vs search today, AI error rate (24 h), provider health. |
| AD-2 | User management | List with search/filter (email, role, status, plan) + pagination; view one; change role or status (suspend revokes sessions); soft delete. |
| AD-3 | Subscription management | List users with plan and today's usage (filter by plan); change a user's plan. |
| AD-4 | AI provider management | PR-1 … PR-7. |
| AD-5 | API usage analytics | `GET /admin/analytics/usage?from&to&groupBy=day|provider|feature` → counts, success rate, average latency. |
| AD-6 | Request logs | `GET /admin/logs/requests?from&to&status&userId&path&page&limit`. |
| AD-7 | System health | `GET /admin/health`: DB ping + latency, uptime, memory, Node version, provider statuses. Public `GET /health` returns only `{status}`. |

---

## 6. API overview

Base path **`/api/v1`** · Swagger UI **`/api/docs`** · OpenAPI JSON **`/api/docs-json`**
🔓 public · 🔑 logged in · 👑 admin

| Area | Method & path | Auth |
|---|---|---|
| Health | `GET /health` | 🔓 |
| Auth | `POST /auth/register` · `POST /auth/login` · `POST /auth/refresh` · `POST /auth/verify-email` | 🔓 |
| | `POST /auth/logout` · `POST /auth/logout-all` · `POST /auth/resend-verification` | 🔑 |
| Users | `GET /users/me` · `PATCH /users/me` · `PATCH /users/me/password` · `DELETE /users/me` | 🔑 |
| Plans | `GET /plans` | 🔓 |
| Subscriptions | `GET /subscriptions/me` · `POST /subscriptions/me/change` · `GET /subscriptions/me/usage` | 🔑 |
| Providers | `GET /providers` | 🔑 |
| Chat | `POST /chat/messages` · `POST /chat/conversations` · `GET /chat/conversations` · `GET /chat/conversations/:id` · `PATCH /chat/conversations/:id` · `DELETE /chat/conversations/:id` | 🔑 |
| | `POST /chat/conversations/:id/messages` · `POST /chat/conversations/:id/messages/stream` (bonus) | 🔑 |
| Search | `POST /search` · `GET /search/history` · `DELETE /search/history` · `DELETE /search/history/:id` · `GET /search/recent` · `GET /search/suggestions` | 🔑 |
| Admin | `GET /admin/dashboard` · `GET /admin/health` | 👑 |
| | `GET /admin/users` · `GET /admin/users/:id` · `PATCH /admin/users/:id` · `DELETE /admin/users/:id` | 👑 |
| | `GET /admin/subscriptions` · `PATCH /admin/subscriptions/:userId` | 👑 |
| | `GET /admin/providers` · `POST /admin/providers` · `PATCH /admin/providers/:id` · `DELETE /admin/providers/:id` · `PATCH /admin/providers/:id/status` · `PATCH /admin/providers/:id/default` · `POST /admin/providers/:id/health-check` · `GET /admin/providers/health` | 👑 |
| | `GET /admin/analytics/usage` · `GET /admin/logs/requests` | 👑 |

**Conventions**
- JSON, camelCase fields, ISO-8601 UTC timestamps.
- Lists: `?page=1&limit=20` (max 100) → `{ data: [...], meta: { page, limit, total, totalPages } }`.
- `Authorization: Bearer <accessToken>`.
- Another user's resource returns `404` (not `403`), so its existence isn't revealed.

**Swagger requirements (every endpoint):** summary, tag, 🔒 lock when auth is needed, path/query parameters, request body DTO with `example`, success response with `example`, every possible error response (shared `ErrorResponseDto`).

---

## 7. Error format and codes

Every error has the same shape:
```json
{ "statusCode": 429, "code": "USAGE_LIMIT_EXCEEDED", "message": "Daily limit of 20 requests reached",
  "details": { "limit": 20, "used": 20, "remaining": 0, "resetsAt": "2026-09-30T00:00:00.000Z" },
  "timestamp": "2026-09-29T10:15:00.000Z", "path": "/api/v1/search", "requestId": "…" }
```

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | invalid body or query (fields in `details`) |
| 401 | `UNAUTHORIZED` | missing, invalid or expired access token, revoked session |
| 401 | `INVALID_CREDENTIALS` | wrong email/password or wrong current password |
| 401 | `REFRESH_TOKEN_INVALID` / `REFRESH_TOKEN_REUSED` | bad or re-used refresh token |
| 403 | `FORBIDDEN` / `ACCOUNT_DISABLED` | wrong role / suspended account |
| 404 | `NOT_FOUND` | missing or not yours |
| 409 | `EMAIL_TAKEN` · `ALREADY_ON_PLAN` · `PROVIDER_IS_DEFAULT` · `PROVIDER_DISABLED` · `LAST_ADMIN` | business-rule conflicts |
| 429 | `USAGE_LIMIT_EXCEEDED` · `RATE_LIMITED` | daily plan quota / too many requests per minute |
| 500 | `INTERNAL_ERROR` | unexpected (no stack trace in the response) |
| 502 | `PROVIDER_ERROR` | AI provider returned an error |
| 504 | `PROVIDER_TIMEOUT` | AI provider didn't answer in 30 s |

---

## 8. Key flows

### 8.1 Token lifecycle
```mermaid
sequenceDiagram
  participant C as Extension
  participant A as API
  participant DB as Postgres
  C->>A: POST /auth/login
  A->>DB: create session (hash of refresh token)
  A-->>C: access (15 min, sid) + refresh (7 d, sid)
  C->>A: GET /users/me (Bearer access)
  A->>DB: session sid still active?
  A-->>C: 200
  C->>A: POST /auth/refresh (refresh R1)
  A->>DB: hash(R1) matches? store hash(R2)
  A-->>C: new access + R2
  C->>A: POST /auth/refresh (old R1 again)
  A->>DB: no match, revoke session
  A-->>C: 401 REFRESH_TOKEN_REUSED
```

### 8.2 Chat message
```mermaid
sequenceDiagram
  participant C as Extension
  participant S as ChatService
  participant U as SubscriptionsService
  participant P as Provider adapter
  participant DB as Postgres
  C->>S: POST /chat/conversations/:id/messages
  S->>DB: conversation belongs to user?
  S->>U: useRequest(userId): atomic UPDATE with limit check
  U-->>S: ok (remaining) or 429
  S->>DB: load last 20 messages
  S->>P: chat(history + prompt)
  alt provider ok
    P-->>S: answer + latency
    S->>DB: save USER + ASSISTANT messages
    S-->>C: 201 messages + usage.remaining
  else provider fails
    S->>U: giveBackRequest(userId)
    S-->>C: 502 PROVIDER_ERROR
  end
```

---

## 9. Non-functional requirements

| Area | Requirement |
|---|---|
| **Security** | bcrypt passwords · JWT secrets from env · refresh rotation + reuse detection · session check on every request · AES-256-GCM provider keys, never returned or logged · `helmet` · CORS allow-list from env (incl. `chrome-extension://<id>`) · rate limit 60 req/min per IP, 5/min on login · `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` · parameterized queries only · no secrets in git |
| **Architecture** | Modular NestJS, exact layout and rules in §10. Controllers thin, rules in services, provider calls behind adapters. |
| **Data integrity** | Transactions for register, default-provider switch and chat save. DB constraints as in the ERD. |
| **Error handling** | One global exception filter, one error shape (§7), no stack traces in responses, provider errors mapped to 502/504. |
| **Performance** | Non-AI endpoints < 200 ms locally; indexes per ERD §4; every list paginated. |
| **Observability** | `x-request-id` per request, one log line per request, `api_usage_logs` table. |
| **Scalability** | Stateless API (JWT + DB sessions) → run many instances behind a load balancer. Usage counter and cache in Postgres now, Redis later. Log table can be partitioned by month. |
| **Config** | All settings from env, validated at startup; the app refuses to start if a required value is missing. |

---

## 10. Project structure

One folder per business module, shared code in `common/`, database files in `database/`. Every module has the same inner shape.

```text
echogpt-backend/
├── docs/
│   ├── PRD.md · ERD.md · ERD.png
│   ├── ARCHITECTURE.md                # module diagram, request lifecycle, provider layer
│   ├── DECISIONS.md                   # numbered decisions + why
│   └── AI_LOG.md                      # how AI tools were used (accepted / changed)
├── postman/
│   └── EchoGPT.postman_collection.json
├── src/
│   ├── main.ts                        # helmet, CORS, ValidationPipe, Swagger, /api/v1 prefix
│   ├── app.module.ts                  # config, TypeORM, throttler, all modules
│   │
│   ├── config/
│   │   ├── configuration.ts           # typed config (app, db, jwt, crypto, plans, ai, search)
│   │   ├── env.validation.ts          # app refuses to start on invalid .env
│   │   └── swagger.config.ts
│   │
│   ├── common/
│   │   ├── constants/
│   │   │   ├── error-codes.ts
│   │   │   └── plans.ts               # FREE / PREMIUM: name, price, limit from env
│   │   ├── decorators/                # current-user, public, roles, api-error-responses
│   │   ├── dto/                       # pagination-query, paginated-response, error-response
│   │   ├── enums/                     # RoleName, UserStatus, PlanCode, ProviderType, …
│   │   ├── exceptions/app.exception.ts
│   │   ├── filters/all-exceptions.filter.ts
│   │   ├── guards/                    # jwt-auth.guard (global + session check), roles.guard
│   │   ├── interceptors/request-logging.interceptor.ts   # writes api_usage_logs
│   │   ├── middleware/request-id.middleware.ts
│   │   └── utils/                     # crypto.util (AES-GCM, SHA-256), pagination, text (normalize, mask)
│   │
│   ├── database/
│   │   ├── data-source.ts             # for the TypeORM CLI
│   │   ├── migrations/
│   │   │   └── 1790000000000-InitialSchema.ts
│   │   └── seeds/seed.ts              # idempotent: roles, demo users + subscriptions, providers
│   │
│   └── modules/
│       ├── auth/
│       │   ├── auth.module.ts
│       │   ├── auth.controller.ts     # register, login, refresh, logout(-all), verify-email
│       │   ├── auth.service.ts
│       │   ├── token.service.ts       # sign/verify JWTs, create/rotate/revoke sessions
│       │   ├── strategies/jwt-access.strategy.ts
│       │   ├── dto/
│       │   └── entities/session.entity.ts
│       │
│       ├── users/
│       │   ├── users.module.ts
│       │   ├── controllers/
│       │   │   ├── users.controller.ts          # /users/me …
│       │   │   └── admin-users.controller.ts    # /admin/users …
│       │   ├── users.service.ts
│       │   ├── dto/
│       │   └── entities/ (user.entity.ts, role.entity.ts)
│       │
│       ├── subscriptions/             # plans, plan changes AND the usage counter
│       │   ├── subscriptions.module.ts
│       │   ├── controllers/
│       │   │   ├── plans.controller.ts                  # /plans
│       │   │   ├── subscriptions.controller.ts          # /subscriptions/me, /me/change, /me/usage
│       │   │   └── admin-subscriptions.controller.ts    # /admin/subscriptions
│       │   ├── subscriptions.service.ts                 # useRequest(), giveBackRequest(), getUsage()
│       │   ├── dto/
│       │   └── entities/subscription.entity.ts
│       │
│       ├── providers/
│       │   ├── providers.module.ts
│       │   ├── controllers/
│       │   │   ├── providers.controller.ts          # GET /providers
│       │   │   └── admin-providers.controller.ts    # CRUD, status, default, health
│       │   ├── providers.service.ts
│       │   ├── adapters/
│       │   │   ├── ai-provider-adapter.interface.ts # chat(), search(), healthCheck()
│       │   │   ├── adapter.factory.ts
│       │   │   ├── openai.adapter.ts
│       │   │   ├── anthropic.adapter.ts
│       │   │   ├── gemini.adapter.ts
│       │   │   └── mock.adapter.ts
│       │   ├── dto/
│       │   └── entities/ai-provider.entity.ts
│       │
│       ├── chat/
│       │   ├── chat.module.ts
│       │   ├── chat.controller.ts
│       │   ├── chat.service.ts
│       │   ├── dto/
│       │   └── entities/ (conversation.entity.ts, chat-message.entity.ts)
│       │
│       ├── search/
│       │   ├── search.module.ts
│       │   ├── search.controller.ts   # search, history, recent, suggestions
│       │   ├── search.service.ts      # includes the 1-hour cache lookup
│       │   ├── dto/
│       │   └── entities/web-search.entity.ts
│       │
│       ├── logging/
│       │   ├── logging.module.ts
│       │   ├── api-usage-log.service.ts
│       │   └── entities/api-usage-log.entity.ts
│       │
│       ├── admin/                     # cross-module views only
│       │   ├── admin.module.ts
│       │   ├── controllers/
│       │   │   ├── dashboard.controller.ts      # /admin/dashboard
│       │   │   ├── analytics.controller.ts      # /admin/analytics/usage
│       │   │   ├── logs.controller.ts           # /admin/logs/requests
│       │   │   └── system-health.controller.ts  # /admin/health
│       │   ├── admin-stats.service.ts
│       │   └── dto/
│       │
│       └── health/
│           ├── health.module.ts
│           └── health.controller.ts   # public GET /health
│
├── test/
│   ├── jest-e2e.json
│   ├── setup/ (test-app.ts, factories.ts)
│   └── e2e/ (auth, roles, usage, chat, providers, search).e2e-spec.ts
│
├── .env.example · .gitignore · .prettierrc · eslint.config.mjs
├── nest-cli.json · package.json · tsconfig.json · tsconfig.build.json
├── CLAUDE.md                          # rules for AI coding assistants
└── README.md
```

Unit tests sit next to the code (`*.spec.ts`), e.g. `common/utils/crypto.util.spec.ts`, `providers/adapters/openai.adapter.spec.ts`.

### Structure rules

| Rule | Why |
|---|---|
| One module = one business area; it owns its entities, DTOs, service and controllers. | A feature change touches one folder. |
| A feature's admin endpoints live in that feature's module (`admin-*.controller.ts` + `@Roles('ADMIN')`). The `admin` module holds only cross-module views. | Business rules aren't duplicated. |
| Controllers are thin: validate → call service → return DTO. No repositories in controllers. | Rules are testable without HTTP. |
| Modules talk through **exported services**, never another module's repository (e.g. `ChatService` → `SubscriptionsService.useRequest()`, `ProvidersService.getAdapter()`). | Each table has one owner. |
| Provider-specific code exists only in `providers/adapters/`. | New provider = one file. |
| Every DTO has `class-validator` rules and `@ApiProperty({ example })`; every route has `@ApiOperation`, `@ApiBearerAuth` (unless `@Public()`), success and error responses. | Swagger is complete by construction. |
| Entities use snake_case column names exactly as in the ERD; schema changes only via migrations. | Code, ERD and DB never drift. |
| Response DTOs never contain `passwordHash`, `refreshTokenHash` or `apiKeyEncrypted`. | Secrets can't leak. |

---

## 11. Environment variables (`.env.example`)

| Variable | Example | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/echogpt` | local Postgres |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | long random strings | token signing |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `15m` / `7d` | lifetimes |
| `ENCRYPTION_KEY` | 64 hex chars (32 bytes) | provider key encryption |
| `FREE_DAILY_LIMIT` / `PREMIUM_DAILY_LIMIT` | `20` / `500` | plan limits |
| `CORS_ORIGINS` | `http://localhost:3000,chrome-extension://<id>` | allow-list |
| `SEARCH_CACHE_TTL_SECONDS` | `3600` | search cache |
| `AI_REQUEST_TIMEOUT_MS` | `30000` | provider timeout |

---

## 12. Testing

| # | Test | Type |
|---|---|---|
| T1 | Register → login → `/users/me`; duplicate email `409`; wrong password `401` | e2e |
| T2 | Refresh rotation: old refresh token rejected; reuse revokes the session | e2e |
| T3 | Logout: the access token of that session is rejected afterwards | e2e |
| T4 | USER calling `/admin/*` → `403`; ADMIN → `200` | e2e |
| T5 | Usage limit: 21st FREE request → `429`, `remaining = 0`; after upgrade → allowed | e2e |
| T6 | Concurrent requests at limit − 1: exactly one succeeds | e2e |
| T7 | Chat with MOCK saves both messages; another user's conversation → `404` | e2e |
| T8 | Provider key: encrypt/decrypt round-trip; no response ever contains the key | unit + e2e |
| T9 | Only one default provider; disabling the default → `409` | e2e |
| T10 | Search cache: second identical search → `fromCache: true`, provider called once | e2e |
| T11 | Adapters map provider HTTP errors/timeouts to `502` / `504` (fetch mocked) | unit |

---

## 13. Delivery plan (git)

`master` is always green. One `feature/*` branch per row, conventional commits (`feat(auth): …`), 2–5 commits each, PR merged with a **merge commit** (never squash).

| # | Branch | Delivers |
|---|---|---|
| 0 | `master` | PRD, ERD, CLAUDE.md |
| 1 | `feature/project-setup` | Folder structure from §10, config validation, Swagger, error filter, request id, health |
| 2 | `feature/database-schema` | 9 entities, initial migration, seed |
| 3 | `feature/auth` | register, login, refresh rotation, logout, guards |
| 4 | `feature/users` | profile, password, delete, roles, admin users |
| 5 | `feature/subscriptions` | plans, change plan, atomic usage, remaining, admin subscriptions |
| 6 | `feature/ai-providers` | adapters, encryption, admin CRUD, default, health |
| 7 | `feature/chat` | conversations, messages, history |
| 8 | `feature/web-search` | search, history, recent, suggestions, cache |
| 9 | `feature/admin` | dashboard, analytics, request logs, system health |
| 10 | `feature/docs` | README, Swagger polish, Postman collection |
| 11 | bonus | `feature/chat-streaming`, `feature/email-verification` |
| — | `release/v1.0.0` | tag `v1.0.0` |

---

## 14. Deliverables checklist

- [ ] Public GitHub repository with a meaningful commit history
- [ ] README: overview, stack + reasons, architecture, ERD, **local PostgreSQL setup**, env vars, migrations, seed, run, tests, Swagger URL, demo accounts, API overview, decisions, limitations
- [ ] Database migration files (`src/database/migrations`)
- [ ] Swagger / OpenAPI at `/api/docs` covering every endpoint
- [ ] `.env.example` (no real secrets)
- [ ] Postman collection (`postman/EchoGPT.postman_collection.json`)

---

## 15. Requirement coverage (brief → where it's done)

Every line of the brief, and where it is covered in this PRD, the database and the tests.

| Brief requirement | PRD | Endpoint(s) | Table(s) | Test |
|---|---|---|---|---|
| **1. Authentication** | | | | |
| User registration | AU-1 | `POST /auth/register` | users, subscriptions | T1 |
| User login | AU-2 | `POST /auth/login` | users, sessions | T1 |
| Secure logout | AU-4, AU-5 | `POST /auth/logout`, `/logout-all` | sessions | T3 |
| JWT authentication | AU-2, AU-4 | global JWT guard | sessions | T1, T3 |
| Refresh token support | AU-3 | `POST /auth/refresh` | sessions | T2 |
| Password hashing | AU-6 | — | users | T1 |
| Email verification (bonus) | AU-7 | `POST /auth/verify-email`, `/resend-verification` | users | — |
| **2. User management** | | | | |
| User profile | US-1 | `GET /users/me` | users | T1 |
| Update profile | US-2 | `PATCH /users/me` | users | — |
| Change password | US-3 | `PATCH /users/me/password` | users, sessions | — |
| Delete account | US-4 | `DELETE /users/me` | users, sessions | — |
| User roles (Admin/User) | US-5 | `@Roles` guard | roles, users | T4 |
| **3. Subscription management** | | | | |
| Free & Premium plans | SU-1 | `GET /plans` | subscriptions | — |
| Subscription status API | SU-2 | `GET /subscriptions/me` | subscriptions | — |
| Upgrade / downgrade | SU-3 | `POST /subscriptions/me/change` | subscriptions | T5 |
| Usage limits | SU-4 | chat + search | subscriptions | T5, T6 |
| Remaining requests API | SU-5 | `GET /subscriptions/me/usage` | subscriptions | T5 |
| **4. AI provider management** | | | | |
| OpenAI, Claude, Gemini | 5.4 layer | adapters | ai_providers | T11 |
| Add / edit / delete provider | PR-1–3 | `POST/PATCH/DELETE /admin/providers` | ai_providers | T9 |
| Enable / disable | PR-4 | `PATCH /admin/providers/:id/status` | ai_providers | T9 |
| Store API keys securely | PR-5 | — | ai_providers | T8 |
| Default provider selection | PR-6 | `PATCH /admin/providers/:id/default` | ai_providers | T9 |
| Health check endpoint | PR-7 | `POST /admin/providers/:id/health-check`, `GET /admin/providers/health` | ai_providers, api_usage_logs | — |
| **5. Chat API** | | | | |
| Send prompt / receive response | CH-1, CH-2 | `POST /chat/conversations/:id/messages`, `POST /chat/messages` | chat_messages | T7 |
| Provider selection | CH-3 | `providerId` field | chat_messages | T7 |
| Conversation history | CH-4 | `GET /chat/conversations[/:id]` | conversations, chat_messages | T7 |
| Streaming (bonus) | CH-5 | `…/messages/stream` | chat_messages | — |
| **6. Web search API** | | | | |
| Search query | WS-1 | `POST /search` | web_searches | T10 |
| Search history | WS-2 | `GET/DELETE /search/history` | web_searches | — |
| Recent searches | WS-3 | `GET /search/recent` | web_searches | — |
| Search suggestions | WS-4 | `GET /search/suggestions` | web_searches | — |
| Result caching (bonus) | WS-5 | inside `POST /search` | web_searches | T10 |
| **7. Admin panel APIs** | | | | |
| Dashboard statistics | AD-1 | `GET /admin/dashboard` | all | — |
| User management | AD-2 | `/admin/users…` | users | T4 |
| Subscription management | AD-3 | `/admin/subscriptions…` | subscriptions | — |
| AI provider management | AD-4 | `/admin/providers…` | ai_providers | T9 |
| API usage analytics | AD-5 | `GET /admin/analytics/usage` | api_usage_logs | — |
| Request logs | AD-6 | `GET /admin/logs/requests` | api_usage_logs | — |
| System health | AD-7 | `GET /admin/health` | — | — |
| **API documentation** | §6 | Swagger `/api/docs`: params, body, examples, errors, auth | — | — |
| **Database (minimum tables)** | ERD | users, sessions, roles, subscriptions, ai_providers, chat history, web_searches, api_usage_logs | all 9 | — |
| **Submission** | §14 | repo, README, migrations, Swagger, `.env.example`, Postman | — | — |

**Evaluation criteria → where they're addressed:** backend architecture §10 · REST API design §6 · database design ERD · code quality §10 rules · security §9 + PR-5 + AU-3/4 · authentication & authorization §5.1, US-5 · error handling §7 · Swagger §6 · scalability §9 · git commit history §13.

---

## 16. Future improvements

Real payment gateway with webhooks · `plans` table if admins need custom plans · Redis for usage counters, cache and rate limits · queue + retries for AI calls · real web search API (Brave / Tavily) · token-based quotas and cost per model · bring-your-own-key per user · monthly partitioning of `api_usage_logs` · hard delete / data export (GDPR) · Docker image and CI/CD.