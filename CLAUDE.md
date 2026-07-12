# CLAUDE.md

> Standing instructions for Fable on the Callout project.
> Read this file, plan.md, decisions.md, and timeline.md in full before starting any phase.
> If anything here conflicts with a specific instruction handed off at phase start, ask before proceeding — do not silently override.
> Phase-level session behavior (stop points, front-loading, phase-end checklist, PR format) lives in CLAUDE.local.md — read that too before starting any phase.

---

## 0. Project Status — pre-build (read first)

Planning is complete and locked. The full data model, MVP scope, and the entire post-MVP feature spec (targeting, elimination, admin/host-transfer, recurring cadence, moderation, media types, push notifications, production readiness) were closed before any phase plan was written — nothing in this project is a TBD handed to the build. See decisions.md for the sourced decisions and plan.md for the phase-by-phase breakdown.

Phase 0 has not started. No code exists yet. This file, plan.md, decisions.md, build-log.md, and timeline.md are the seed state for the first session.

Work proceeds one phase at a time, in order, per plan.md. Do not start a phase before the previous one is marked complete in plan.md and closed out per CLAUDE.local.md's phase-end checklist.

---

## 1. What This Project Is

Callout is a chain-challenge relay game. One player completes an act, calls out the next person, who must complete it within a time limit and continue the chain — a "social rules engine" for challenge chains, not a single-purpose fitness app. The engine supports many act types (reps, video, photo, text prompts) and two tones (casual — miss the deadline and the chain just moves on; competitive — miss it and you're eliminated).

It is being built for real use with friend/fitness/community groups at a scale of hundreds to low-thousands of concurrent users — not a throwaway prototype, but also not architected for millions. See decisions.md D005.

---

## 2. Locked Architecture Rules — Do Not Violate

If a task seems to require breaking one of these, stop and flag it in the phase-end summary rather than working around it silently — see CLAUDE.local.md's front-loading section for how ambiguity is meant to be handled without a mid-phase pause.

### 2.1. Server-authoritative deadlines

No client ever owns a clock. Turn.deadline_at and Round.ends_at (for recurring cadence) are the source of truth. Clients render timeRemaining as deadline_at minus serverNow(). No local interval timer is ever authoritative. Turn auto-advance (deadline passed, resulting in a miss, an auto-advance, or an elimination depending on tone) is driven server-side — never by a client timer firing a transition.

### 2.2. Game logic lives in Postgres, not the client

All state-mutating actions (create group, join, call out, submit, mark missed, advance round, flag, moderate, transfer host, etc.) go through RPC functions. The client reads tables, filtered by RLS, and calls RPCs. It never writes directly to group, membership, round, turn, submission, volunteer, submission_comment, or notification.

### 2.3. RLS protects all group data

Every user-facing table has Row Level Security. Non-members of a group cannot read its data. Removed players cannot act. Eliminated players can still read (they retain visibility per decisions.md D012) but cannot be targeted or act as the active turn-holder.

### 2.4. Membership has two independent fields — do not collapse them

Role is one of host, admin, or player. Status is one of invited, active, removed, or out-eliminated. A player who is eliminated but still an admin is role=admin, status=out-eliminated — both true at once. Code that conflates role and status will be rejected.

### 2.5. Turn state vs. Submission validation are separate concerns

Turn.status (the relay's position: pending, submitted, missed, eliminated, redo-pending, or skipped) and Submission.validation_status (completed or flagged) are deliberately decoupled. Flagging a submission reverts the player's Turn status to redo-pending — it does not pause, block, or otherwise halt the live relay position for anyone else. See decisions.md D016.

### 2.6. Fairness is a hard, always-on constraint — no toggle

In both manual and random targeting modes, a player who has already gone this round is never eligible to be called again until everyone eligible has gone. This is enforced by querying membership against turns-this-round, not a stored per-user counter (there is no daily cap — see decisions.md D008). No override exists in either mode.

### 2.7. Idempotency for transitions

Turn auto-advance, round auto-close/restart for recurring cadence, and any RPC two clients could plausibly call in the same millisecond must be idempotent.

---

## 3. Stack

Locked. Do not propose alternatives unless the user explicitly reopens the conversation.

Mobile: React Native, Expo, TypeScript, Expo Router. Backend: Supabase — Postgres, Realtime, Auth, Storage. Auth: Supabase Auth, real accounts, not anonymous or guest-first, unlike Shot O'Clock — groups are persistent and recurring, so identity needs to survive across devices and sessions from day one; see decisions.md D004. Logic: Postgres functions and RPCs, behind RLS. Realtime: Supabase Realtime channels for live group, turn, and roster updates. Storage: Supabase Storage, Phase 10 and later only, for video and photo. Scheduling: pg_cron or Supabase scheduled functions, for turn auto-advance and recurring cadence resets. Builds: Expo and EAS, with an EAS development build required starting Phase 11 for real push notifications.

Always verify the current stable version before installing any dependency. Run `npm view <pkg> version` or check official docs — do not assume training-data versions are current.

---

## 4. MVP Scope (Phases 0–4)

### 4.1. In scope

Create group (name, invite specific players), accept/join, host starts game. Single act type: text only. Manual targeting only. Casual tone only — missed deadline auto-advances, no elimination. Per-turn deadline, fixed per group at creation. Round cadence hardcoded to immediate. Turn/Round state machine. Foreground/in-app notifications only. Basic game-state view. Host-only controls (add/remove players, skip a turn) — no admin role yet.

### 4.2. Explicitly out of MVP (built later, but fully specified — never TBD)

Random targeting, volunteer/hand-raise, competitive tone plus elimination, admin role, host transfer, submission flagging/redo, comments, recurring cadence, video/photo act types, real push notifications, media storage. Every one of these is fully specified in decisions.md and assigned a phase in plan.md — none of them are open questions waiting to be resolved mid-build.

### 4.3. Future-ready, but not future-built

The full schema (all tables, all enums) is built in Phase 1, before the MVP's UI exists, precisely so later phases never require a schema migration to add a concept, only to activate logic against fields that already exist. Do not strip fields that aren't yet used by the current phase.

---

## 5. Code Quality Standards

### 5.1. TypeScript

Strict mode on. No `any` without a comment justifying it. Explicit return types on exported functions and anything non-trivial. Use `type` for unions and object shapes, `interface` for things meant to be extended. Shared types centralized in src/types/. RPC parameter and return shapes typed once in src/types/api.ts and imported everywhere.

### 5.2. Linting and formatting

ESLint with @typescript-eslint, plus Prettier, run on save. Recommended rules: no-unused-vars, no-console as a warning, prefer-const, eqeqeq, react-hooks/exhaustive-deps. Two-space indent, single quotes, trailing commas in multi-line, semicolons on. Suppressed rules must have an inline comment explaining why.

### 5.3. File and folder organization

app/ for routes via Expo Router, src/features/<feature>/ for feature-grouped code, src/components/ for cross-feature shared UI, src/lib/ for low-level utilities like the supabase client and time helpers, src/types/ for shared types. One component per file, file name matches the exported component. No deep relative imports — use path aliases such as @/features/*, @/lib/*, and @/types/*.

### 5.4. Naming conventions

PascalCase for components, types, and interfaces. camelCase for functions, variables, and hooks, with hooks starting with "use". SCREAMING_SNAKE_CASE for module-level constants and enums. kebab-case for route files and assets. No abbreviations beyond industry-standard ones like url, id, or db.

### 5.5. Component structure

Functional components with hooks only — no class components. Top-down order within a component: hooks, then derived values via useMemo, then handlers via useCallback, then effects via useEffect, then early returns, then render.

### 5.6. Comments

Comment why, not what. For non-obvious game logic — fairness edge cases, idempotency tricks, elimination or reinstatement timing — point to the relevant decisions.md entry, for example noting that reinstated players are eligible next round rather than immediately, per D012. TODOs include author and date.

### 5.7. Error handling

Never silently swallow errors. RPCs return structured error info, an error code plus a message, not bare throws. User-facing errors go through a consistent error UI component.

### 5.8. Magic numbers and strings

Extract to named constants. Enum-like strings such as turn status or membership role come from a typed source, never a raw string literal at the call site.

### 5.9. CI readiness

CI isn't wired up yet, but every change should pass as if it were: lint clean, typecheck clean, migrations idempotent against a fresh database, no hardcoded secrets or absolute paths, cross-platform npm scripts.

### 5.10. No manual line breaks — this is the one formatting rule that applies everywhere

This is the single, canonical statement of this rule. It is not repeated in plan.md, decisions.md, build-log.md, timeline.md, or CLAUDE.local.md — it applies to all of them, and to every commit message, by virtue of living here.

Write every paragraph, bullet, and commit-message line as one continuous piece of text and let it wrap naturally in whatever renders it — an editor, a terminal, GitHub's diff view, a chat window. Never manually insert a line break partway through a sentence or a bulleted line, no matter how long it runs. This applies everywhere in this project: every .md file, every commit message body, every PR description. A sentence that runs to 300 characters on one physical line is correct. That same sentence broken across two or three physical lines because it "looked long" is not, even if the intent was readability — it renders as disconnected fragments in a lot of tools (git log, GitHub's mobile view, some editors) instead of one statement. If a line is genuinely too long as an idea, split it into two separate sentences or two separate bullets — don't just wrap the one sentence you have.

---

## 6. Dependency Management

Before installing anything: check current stable version, check changelog for major-version notes, confirm Node LTS and Expo SDK compatibility. Caret ranges in package.json, commit the lockfile. Deprecated APIs get flagged with a comment and a proposed replacement, never silently used. Prefer a well-established library over a hand-rolled workaround for the obviously-right tool — SVG, charts, gestures, date math, camera or video handling for Phase 10 — see section 10 for how approval works without a mid-phase pause.

Specific stack notes: pin a specific Expo SDK, don't mix RN versions. Use @supabase/supabase-js v2 patterns only. Expo Router is the only navigation library — don't introduce React Navigation alongside it. Postgres functions: plpgsql for control flow, sql for simple expressions, SECURITY DEFINER only when necessary and documented why.

---

## 7. Build Philosophy — Phase-Gated, Not Feature-Gated

This project is built by Fable, not Claude Code driven by a human typing feature-by-feature prompts. The unit of review is the phase, not the commit or the feature. Fable is handed a fully-specified phase — this file, plan.md's entry for that phase, decisions.md, and the original planning document for any deep-spec detail — and works it to completion autonomously — no mid-phase check-ins, no per-feature approval gate, no diff-review-before-writing step of any kind, including for SQL migrations.

This inverts Shot O'Clock's model on purpose: there, Claude Code stopped constantly and the human reviewed continuously. Here, review happens once, at the end of a fully-built phase, against a working result. See CLAUDE.local.md for exactly how that works — front-loading, the phase-end checklist, and what happens when something wasn't anticipated.

### 7.1. Everything a phase needs must already be in front of you when it starts

If plan.md, decisions.md, and the planning document don't cover something the phase needs, that is a front-loading gap, not a mid-phase question. See CLAUDE.local.md.

### 7.2. Commit as you go, within the phase

Commit whenever the code is in a self-consistent state — a migration applies cleanly, an RPC compiles and its happy path works, a screen renders, a test passes. A phase will typically produce many commits. Don't produce one giant "phase complete" commit. Git conventions are in section 9.

### 7.3. Never expand scope unilaterally

If, mid-phase, you notice work that belongs to a different phase, do not pull it forward. Note it in the phase-end summary as a candidate for a future phase, and leave plan.md's phase boundaries alone unless the user asks you to resequence.

---

## 8. Documentation Discipline

The planning document remains authoritative for full spec detail not yet promoted into decisions.md. decisions.md, plan.md, build-log.md, and timeline.md are the local working memory of the build — kept lean and genuinely useful, not exhaustive documentation for its own sake, per decisions.md D003.

When a phase adds or changes an RPC, its contract should be inferable from the code and the phase's build-log entry — there is no separate rpc-contracts.md for this project. When a phase changes schema, the migration file's own comments are the documentation of record. Full session-start ritual, phase-end checklist, and build-log/timeline/PR mechanics: CLAUDE.local.md.

---

## 9. Git Conventions

### 9.1. Branch strategy

The main branch is always green and deployable. Each phase gets its own branch, named phase/<n>-<short-name>, for example phase/3-mvp-core-loop. A phase is developed on its own branch and merged via the PR Fable opens at phase end — see CLAUDE.local.md, which differs from Shot O'Clock, where the human created the PR manually.

### 9.2. Commit message format

A commit has a type and an imperative summary with no period, followed by a blank line, followed by two or more body bullets describing what changed, followed optionally by a References line pointing at a decisions.md entry when relevant. Types are feat, fix, chore, refactor, docs, test, style, and wip. Each commit needs at least two body bullets unless it's a trivial one-line change. Every bullet and every line follows the no-manual-line-breaks rule in section 5.10 — let it wrap, don't hard-wrap it yourself.

Commits never include a Co-Authored-By trailer or any other co-author attribution, regardless of Claude Code's default behavior. The commit author is you; Fable is a tool being used, not a contributor of record.

wip is only for intentionally incomplete checkpoints and is never left in main once the task is complete.

### 9.3. Examples

A good commit reads like this: the summary line is "feat: add call_out_player RPC", followed by a blank line, followed by bullets such as "validate caller holds the active turn before allowing a callout," "enforce fairness-window eligibility on the target," and "create the new Turn row and set deadline_at from group settings," followed by "References: decisions.md D014."

A bad commit reads like this: the summary line is "feat: phase 3 complete", followed by vague bullets like "did the core loop" and "40 files changed" — too coarse to tell a reviewer anything real about what changed.

### 9.4. Never commit

.env, node_modules/, build outputs, secrets of any kind, supabase/.branches/ and supabase/.temp/, IDE-specific configs, and anything reproducible from source. .env.example IS committed, with placeholders for every expected variable.

### 9.5. Pushing and PRs

Push after each commit. At phase end, Fable pushes the phase branch and opens the PR itself — not just a description for the user to paste in. See CLAUDE.local.md's Pull Requests section for the exact format and mechanics.

---

## 10. What Gets Front-Loaded, Not Asked Mid-Phase

Because Fable does not stop mid-phase, everything that would traditionally be a "pause and ask" moment must be resolved before the phase starts, or handled per CLAUDE.local.md's judgment-with-flagging rule. Before handing off a phase, make sure the following are settled: any new dependency the phase will plausibly need, such as camera or video libraries for Phase 10 or push notification libraries for Phase 11, either pre-approved or explicitly left to Fable's judgment within section 6; any product or architecture ambiguity plan.md's entry for that phase doesn't already resolve via decisions.md; and anything that would touch billing, real user data, or destructive operations in a non-local environment.

If something genuinely wasn't front-loaded and comes up mid-phase anyway, Fable makes the most reasonable call consistent with section 2's locked rules, documents it as a new decisions.md entry, and flags it clearly in the phase-end summary — it does not stop and wait. See CLAUDE.local.md.

---

## 11. Hard "Do Not" Rules

Do not put deadline or timer state on the client. Do not let the client write directly to group-state tables. Do not collapse Membership's role and status into one field. Do not let a flagged submission block or pause the live relay position for anyone but the flagged player. Do not add a feature from a later phase into an earlier one, even if it looks small. Do not invent game rules — if decisions.md and the planning document are genuinely silent, follow section 10. Do not commit secrets or real env values. Do not drop or destructively alter existing migrations — add a new one instead. Do not use `any` without a justifying comment. Do not silently catch and ignore errors. Do not stop mid-phase to ask a question that could have been front-loaded — flag it and keep going instead, per section 10. Do not manually break a line mid-sentence anywhere in this project — see section 5.10.

---

## 12. Where to Look for More Detail

Progress and current phase: plan.md. Rationale behind a past choice: decisions.md. Full original spec detail not yet promoted into decisions.md — the data model walkthrough, user stories, screen flow: the planning document. Phase-end mechanics, stop points, PR and commit ritual: CLAUDE.local.md. Narrative history of what's been built and why: build-log.md and timeline.md.

---

## 13. Operating Principle

Be a trusted executor within a phase, not a creative author across phase boundaries. The planning work is done — decisions.md and plan.md are the map. Within a phase, Fable has full latitude on implementation detail and should use it; across phase boundaries, scope stays exactly what plan.md says it is. When something is genuinely ambiguous and unresolvable from the documents on hand, make the most defensible call, write it down, flag it, and keep moving — the review happens at phase end, against a working result, not mid-flight.