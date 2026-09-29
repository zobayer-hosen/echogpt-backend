# CLAUDE.md — rules for AI coding assistants

EchoGPT Backend: REST API for a multi-AI Chrome extension.
**Source of truth:** `docs/PRD.md` and `docs/ERD.md`. If code must differ from them, stop and ask.

## Stack
- NestJS (TypeScript), local PostgreSQL (no Docker), TypeORM with migrations (`synchronize: false`)
- Swagger (OpenAPI 3), JWT (access + rotating refresh), bcrypt, class-validator
- Jest + supertest for unit and e2e tests
- AI providers called with plain `fetch` behind adapters
- No Prisma, no Redis, no Docker

## Structure
- Folder layout exactly as PRD §10. One module = one business area.
- Controllers are thin: validate → call service → return DTO. No repositories in controllers.
- Modules talk through exported services, never another module's repository.
- Provider-specific code lives only in `src/modules/providers/adapters/`.
- Entities use snake_case column names exactly as in the ERD; schema changes only via migrations.
- Unit tests sit next to the code (`*.spec.ts`); e2e tests in `test/e2e/`.

## API
- Base path `/api/v1`, Swagger at `/api/docs`, JSON at `/api/docs-json`.
- Every endpoint fully documented in Swagger: summary, tag, auth lock, params, body example,
  success response example and every error response (`ErrorResponseDto`).
- One error shape (PRD §7) from one global exception filter. No stack traces in responses.
- Lists: `?page&limit` (max 100) → `{ data, meta: { page, limit, total, totalPages } }`.
- Another user's resource → `404`, not `403`.

## Security
- Never return or log passwords, token hashes, API keys or `.env` values.
- Response DTOs never contain `passwordHash`, `refreshTokenHash` or `apiKeyEncrypted`.
- Never commit `.env`. Never read credentials on this machine (gh tokens, keychains, other `.env` files).

## Git
- `master` is always green. One `feature/<name>` branch per PRD §13 row.
- Commits: `<type>(<scope>): <short description>`, ~50 chars max, lowercase, no body.
  One small change per commit, 2–5 commits per branch.
  Good: `feat(auth): add login` · `test(chat): add chat tests` · `fix(auth): reject reused refresh token`.
  Never: "update", "fix bug", "final", long sentences.
- PRs merged with a merge commit (never squash), branches never deleted.

## Before pushing a branch
1. `npm run lint` · `npm run build` · `npm test` · `npm run test:e2e`
2. Start the app and curl at least one endpoint of the branch.
3. Never weaken a test to make it pass; fix the code in a `fix(...)` commit.

## Keep updated
- `docs/DECISIONS.md` — numbered decisions and why.
- `docs/AI_LOG.md` — how AI tools were used (accepted / changed).
