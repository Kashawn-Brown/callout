# Timeline

## Current Status
*Last updated: 2026-07-12*

Phase 1 — Full database schema is complete and its PR is open against main. The entire data model — every table, enum, and constraint for MVP and all post-MVP features through Phase 12 — now exists as two migrations, with Row Level Security on every table and a 53-test pgTAP suite proving the access tiers (non-members read nothing, invited members see only the group row and roster, eliminated members retain visibility, all game-state writes are RPC-only). Four schema-level judgment calls were logged as D023–D026. Development still runs against the local Docker stack; a hosted Supabase project needs the user's `supabase login` before Phase 3 (D021). Next up: Phase 2 — auth and the app shell.

---

Phase sections will be appended below, in order, as each phase closes. Per CLAUDE.local.md, each entry is a short italicized `*Month Year*` date line followed by prose written as history — no bullets — and a continuity check (Phase 0, 1, 2, … with no gaps) runs before each new section is added.

## Phase 0 — Skeleton
*July 2026*

Phase 0 turned the planning-only repo into a project that actually runs. It scaffolded the mobile app from Expo's SDK 57 default template, stripped the demo screens down to a minimal root layout and placeholder home screen, and locked in the project's code standards as enforced tooling: strict TypeScript, ESLint with the required rule set, Prettier, and the @/* path alias into src/. The backend came up as a local Supabase stack in Docker, shifted to its own port range so it coexists with Shot O'Clock's local stack, with the app reading its connection from environment variables and proving connectivity through a health check surfaced on the home screen. Two toolchain incompatibilities in Expo's lint config were worked around and pinned (D022), and the decision to develop local-first against Docker rather than block on a hosted Supabase project was made autonomously and logged as D021 — the one call in this phase that needs the user's follow-up, since a hosted project must exist before Phase 3.

## Phase 1 — Full database schema
*July 2026*

Phase 1 gave Callout its entire data model in one pass, before any screen or game logic exists, so that no later phase ever needs a migration to add a concept — only to activate logic against fields that already exist. One migration created all nine enums and nine tables (profile plus the eight game tables), encoding the locked rules structurally where the database can hold them: role and status as independent membership fields, composite foreign keys guaranteeing a turn's target is a member of that exact group, and partial unique indexes enforcing one host per group, one in-progress round per group, and one pending turn per round. A second migration put Row Level Security on every table, built around SECURITY DEFINER helper predicates that check membership status without recursing, and revoked write privileges on all game tables outright so the client-writes-nothing rule holds at the privilege layer beneath the policies. A 53-test pgTAP suite, runnable via npm run test:db, verified every visibility tier and the write posture against a fresh database. The phase surfaced four gaps the planning documents hadn't closed, each resolved as a logged judgment call: a profile table the data model never named but three existing decisions implicitly required (D023), a notification table generalized beyond turn scope to cover the committed trigger list (D024), read visibility for invited-but-not-yet-accepted members (D025), and the three columns recurring cadence actually needs to survive DST math (D026).
