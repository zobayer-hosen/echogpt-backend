# Decisions

Numbered decisions and why. PRD/ERD decisions (A1–A9, ERD §7) are not repeated here;
this file records choices made while building.

| # | Decision | Why |
|---|---|---|
| D1 | Local PostgreSQL, no Docker. Developed against PostgreSQL 18 (installed locally); only features available in 16 are used. | PRD §2 non-goal; the brief allows local Postgres. Nothing PG 17/18-specific is used, so 16 works too. |
| D2 | Default branch `master`; the repo is published as `echogpt-backend`. The first placeholder repo (`EchoGPT`) is kept as the `legacy` remote. | PRD §13 uses `master`; the earlier history (initial commit) is kept. |
| D3 | `.gitattributes` forces LF line endings. | Windows `core.autocrlf` would otherwise fight Prettier/ESLint. |
| D4 | e2e tests use a separate database `echogpt_test`, derived from `DATABASE_URL` (override with `TEST_DATABASE_URL`). | Tests never touch dev data; only one URL to configure. |
| D5 | NestJS **11** (CommonJS) + TypeORM 0.3 + TypeScript 5.9 + Jest 30, not NestJS 12. | Nest 12 is ESM-only and its template uses Vitest/oxlint; the brief asks for Jest and PRD §10 lists `jest-e2e.json` and `eslint.config.mjs`. Nest 11 is still maintained; upgrading later is a tooling change, not a code rewrite. |
| D6 | Global pipe, CORS, helmet, prefix and Swagger live in `configureApp()` exported from `main.ts`; e2e tests call the same function. | Tests run exactly the app that ships. |
| D7 | Every DB connection uses `timezone=UTC`. | "Today" for usage counters is the UTC day (PRD A3), so `CURRENT_DATE` must be UTC. |
| D8 | Rate limits are env settings (`RATE_LIMIT_PER_MINUTE=60`, `LOGIN_RATE_LIMIT_PER_MINUTE=5`). | PRD §9 values by default; e2e tests raise them so many logins in a row don't hit 429. |
| D9 | Request logging: `RequestLoggingInterceptor` handles requests that reach a route; the exception filter hands it requests rejected earlier (guards, unknown routes, bad JSON). | Guards run before interceptors, so 401/403/429 would otherwise be missing from the logs. |
| D10 | Public `GET /health` pings the database and answers `{status:"ok"}` or `{status:"down"}` with 503. | Load balancers need a non-200 when the API can't serve; the body still only holds `status`. |
