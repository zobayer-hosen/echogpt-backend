# Architecture

How the EchoGPT backend is put together. The product rules are in [PRD.md](./PRD.md), the database in [ERD.md](./ERD.md), and the reasons behind implementation choices in [DECISIONS.md](./DECISIONS.md).

## 1. Modules

One NestJS module per business area. Each module owns its tables; other modules use its **exported service**, never its repository.

```mermaid
graph LR
  subgraph Public
    Health[health]
  end
  Auth[auth<br/>sessions] --> Users[users<br/>users, roles]
  Users --> Auth
  Users --> Subs[subscriptions<br/>plans + usage counter]
  Auth --> Subs
  Chat[chat<br/>conversations, messages] --> Subs
  Chat --> Providers[providers<br/>ai_providers + adapters]
  Search[search<br/>web_searches] --> Subs
  Search --> Providers
  Providers --> Logging[logging<br/>api_usage_logs]
  Admin[admin<br/>cross-module views] --> Users & Subs & Chat & Search & Providers & Logging
```

| Module | Owns | Exposes to others |
|---|---|---|
| `auth` | `sessions` | `TokenService` (create / rotate / revoke sessions) |
| `users` | `users`, `roles` | `UsersService` (create, login lookup, profile, stats) |
| `subscriptions` | `subscriptions` | `SubscriptionsService.useRequest()`, `giveBackRequest()`, `getUsage()` |
| `providers` | `ai_providers` | `ProvidersService.resolveForUse()` → `{ provider, adapter }` |
| `chat` | `conversations`, `chat_messages` | `ChatService.countPromptsToday()` |
| `search` | `web_searches` | `SearchService.countToday()` |
| `logging` | `api_usage_logs` | `ApiUsageLogService` (write rows, analytics queries) |
| `admin` | — | read-only dashboard, analytics, logs, system health |
| `health` | — | public `GET /health` |

A feature's own admin routes (`/admin/users`, `/admin/subscriptions`, `/admin/providers`) live in that feature's module as `admin-*.controller.ts`, so business rules exist once.

## 2. Request lifecycle

```mermaid
sequenceDiagram
  participant C as Client
  participant MW as RequestIdMiddleware
  participant G as Guards
  participant I as RequestLoggingInterceptor
  participant P as ValidationPipe
  participant H as Controller → Service
  participant F as AllExceptionsFilter
  C->>MW: HTTP request
  MW->>MW: x-request-id, per-request context (AsyncLocalStorage)
  MW->>G: ThrottlerGuard (60/min, 5/min login) → JwtAuthGuard (JWT + session check) → RolesGuard (admin routes)
  G->>I: track request (log on finish)
  I->>P: whitelist, forbid unknown fields, transform
  P->>H: typed DTO
  H-->>C: response DTO
  Note over F: any error → { statusCode, code, message, details?, timestamp, path, requestId }
  Note over I,F: on finish: one log line + one api_usage_logs row (errors rejected by guards are handed to the logger by the filter)
```

- **Controllers are thin**: validate → call one service method → return a DTO.
- **Services hold the rules** and throw `AppException(status, code, message, details)`.
- **Response DTOs** are plain objects built by services; no entity is returned directly, so hashes and encrypted keys can't leak.

## 3. Authentication

```mermaid
sequenceDiagram
  participant C as Extension
  participant A as API
  participant DB as Postgres
  C->>A: POST /auth/login
  A->>DB: insert session (id = sid, SHA-256 of refresh token)
  A-->>C: access JWT (15 min, sid) + refresh JWT (7 d, sid)
  C->>A: any request with Bearer access
  A->>DB: session sid active? user active?
  C->>A: POST /auth/refresh (R1)
  A->>DB: UPDATE … SET hash = H(R2) WHERE id = sid AND hash = H(R1)
  A-->>C: new access + R2
  C->>A: POST /auth/refresh (R1 again)
  A->>DB: hash mismatch → revoke session
  A-->>C: 401 REFRESH_TOKEN_REUSED
```

- Access and refresh tokens use **different secrets** and a `typ` claim, so one can't be used as the other.
- Every request checks the session row, so **logout, logout-all, password change, suspension and account delete take effect immediately**.
- Refresh rotation is a compare-and-swap `UPDATE`, so two concurrent uses of the same token can't both win.

## 4. Usage limits

One atomic statement checks and counts (ERD §3):

```sql
UPDATE subscriptions
SET requests_used = CASE WHEN usage_date = CURRENT_DATE THEN requests_used + 1 ELSE 1 END,
    usage_date    = CURRENT_DATE
WHERE user_id = $1
  AND (usage_date <> CURRENT_DATE OR requests_used < CASE plan WHEN 'PREMIUM' THEN $3 ELSE $2 END)
RETURNING plan, requests_used, (CURRENT_DATE + 1)::timestamptz AS resets_at;
```

Postgres locks the row, so at `limit − 1` exactly one of many concurrent requests succeeds (test T6). Connections run in UTC, so "today" is the UTC day. A failed AI call gives the request back.

## 5. AI provider layer

```mermaid
classDiagram
  class AiProviderAdapter {
    <<interface>>
    chat(messages) ChatResult
    search(query) SearchResult
    healthCheck() HealthResult
  }
  class BaseAdapter {
    fetch + 30 s timeout
    error mapping 502 / 504
    search prompt + JSON parsing
  }
  AiProviderAdapter <|.. BaseAdapter
  BaseAdapter <|-- OpenAiAdapter
  BaseAdapter <|-- AnthropicAdapter
  BaseAdapter <|-- GeminiAdapter
  AiProviderAdapter <|.. MockAdapter
  AdapterFactory ..> AiProviderAdapter : create(type, model, key)
```

- `ProvidersService.resolveForUse(providerId?)` returns the provider (or the default) and an adapter. Unknown → 404, disabled → `409 PROVIDER_DISABLED`.
- Keys are stored AES-256-GCM encrypted (`iv:authTag:ciphertext`), loaded only when an adapter is built, and never returned or logged.
- Web search is AI-assisted: the adapter asks the model for JSON `{answer, results[{title,url,snippet}]}` and tolerates non-JSON answers.
- Adding a provider = one adapter class + one `case` in `AdapterFactory` + one enum value.

## 6. Data and observability

- Schema changes only through migrations; `synchronize` is off. Entities mirror the ERD exactly (checked with `migration:generate`: "No changes").
- `api_usage_logs` gets one row per HTTP request (method, path without query string, status, duration, IP, user) plus AI fields (feature, provider, success) when a provider was called. Request bodies are never stored.
- Search results are cached in `web_searches` itself (same normalized query + provider, 1 hour).

## 7. Scaling notes

- Stateless API: JWT + DB sessions, so any number of instances can run behind a load balancer.
- Usage counters and the search cache are in Postgres today; both can move to Redis without changing the service interfaces.
- The in-memory rate limiter is per instance; a shared store (Redis) is needed for exact limits across instances.
- `api_usage_logs` is append-only with a `bigint` identity key and can be partitioned by month.
