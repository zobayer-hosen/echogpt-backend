# AI Log

How AI tools were used while building this project, and what was accepted or changed.

**Tool:** Claude Code (Claude Opus), run in auto mode with `CLAUDE.md` as its rules.
**Inputs:** `docs/PRD.md` and `docs/ERD.md` (written by the author) as the source of truth.

| Branch | What the AI did | Accepted / changed by review |
|---|---|---|
| `master` | Wrote `CLAUDE.md`, `.gitignore`, `.gitattributes`, `.env.example`, this log and `DECISIONS.md` from the PRD. Renamed the ERD image to `docs/ERD.png` to match PRD §10. | Accepted. |
| `feature/project-setup` | Scaffolded NestJS by hand (checked the Nest 12 template first, chose Nest 11 for Jest, see D5), typed env validation, error filter, request id, request logging, Swagger setup, health endpoint, unit + e2e tests. | Changed: env fields needed explicit types for implicit conversion; Helmet CSP adjusted for Swagger UI on plain http. |
| `feature/database-schema` | Wrote the 9 entities, let TypeORM generate the schema SQL as a draft, then hand-finished the migration (grouped, `DESC` indexes, readable `down`). Verified with `migration:run` → `migration:revert` → `migration:run` and a `migration:generate` drift check ("No changes"). Seed, request-log persistence and schema tests. | Changed: one false drift (`CURRENT_DATE` normalization) fixed in the migration; `@Index` overload for `synchronize: false` corrected. |
| `feature/auth` | Register/login/refresh/logout, session-checked JWT guard, rotating refresh tokens with reuse detection, login rate limit, e2e tests (T1–T3 parts). | Changed: a test showed that two access tokens issued in the same second were identical; fixed in code (`jti` claim), not in the test. |
