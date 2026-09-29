# Decisions

Numbered decisions and why. PRD/ERD decisions (A1–A9, ERD §7) are not repeated here;
this file records choices made while building.

| # | Decision | Why |
|---|---|---|
| D1 | Local PostgreSQL, no Docker. Developed against PostgreSQL 18 (installed locally); only features available in 16 are used. | PRD §2 non-goal; the brief allows local Postgres. Nothing PG 17/18-specific is used, so 16 works too. |
| D2 | Default branch `master`; the repo is published as `echogpt-backend`. The first placeholder repo (`EchoGPT`) is kept as the `legacy` remote. | PRD §13 uses `master`; the earlier history (initial commit) is kept. |
| D3 | `.gitattributes` forces LF line endings. | Windows `core.autocrlf` would otherwise fight Prettier/ESLint. |
| D4 | e2e tests use a separate database `echogpt_test`, derived from `DATABASE_URL` (override with `TEST_DATABASE_URL`). | Tests never touch dev data; only one URL to configure. |
