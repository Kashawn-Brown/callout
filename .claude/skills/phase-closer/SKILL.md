---
name: phase-closer
description: Use this the moment a Callout development phase's Done-when criteria (stated in plan.md) are actually met — do not wait to be asked. This is not optional cleanup at the end of a session; it is the required last step of every phase, covering plan.md, timeline.md, decisions.md, and build-log.md updates, opening the PR, and giving the user the phase-end summary. Trigger this automatically whenever you notice the current phase's work is functionally complete, and also trigger it if the user explicitly says something like "close out this phase," "wrap up," or "let's finish the phase."
---

# Phase Closer

Runs the full Phase-End Checklist from `CLAUDE.local.md` as one procedure, so it happens the same way every time. Unlike Shot O'Clock's build-log workflow, nothing here is a draft-then-approve step — everything gets written and committed directly, and the phase-end summary in chat is the actual review moment.

Do not start this until the phase's Done-when line in `plan.md` is genuinely satisfied. If you're not sure it is, that's a sign to keep working, not to run this early.

## Step 1 — Update plan.md

Tick every completed checklist item for this phase. Update its `**Status:**` line to reflect completion — a short outcome statement, not a recap (e.g. "Complete, verified <date>." not a restatement of everything that was built).

## Step 2 — Update timeline.md

Two edits, in order:

**a. Rewrite the Current Status block** at the top of the file. One short paragraph: where the project stands right now, what phase just closed, what's next. Current state only — this block gets fully overwritten every time, it does not accumulate history.

**b. Append a new phase section at the bottom**, after every existing section, in strict order. Format:

- `## Phase N — Name` heading, matching the name used in `plan.md`
- An italic `*Month Year*` date line — the actual month this phase was built in, not the date this checklist ran
- Prose only, no bullet lists, written as history in past tense ("Phase 3 made the relay loop real, end to end" — not "Phase 3 is complete" or a copy of the Current Status paragraph you just wrote in step 2a)
- Length proportionate to what the phase actually did — most phases are one paragraph; only go longer if the phase genuinely had multiple real throughlines worth explaining separately

**Before finishing this step**, check continuity: the sections at the bottom of the file must run `Phase 0, Phase 1, Phase 2, …` up through the phase before this one, with no gaps. If a prior phase's section is missing, backfill it now from `build-log.md` and git history before adding the new one — don't leave a hole and move on.

## Step 3 — Update decisions.md

Add an entry for anything decided during this phase that isn't already captured — including, importantly, any judgment call you made mid-phase without a check-in, per `CLAUDE.local.md`'s front-loading rules. Use the existing format: `## D0xx — Title`, one paragraph, states what was decided and why, ends with a "would change if..." line where a real trigger exists. Number sequentially from the highest existing D-number in the file.

## Step 4 — Write the build-log.md entry

Write the full entry for this phase now, in one pass — not incrementally. Format, per `CLAUDE.local.md`:

- `## Phase N — Name` heading
- One prose paragraph per meaningful unit of work, with small or mechanical commits folded into the nearest substantive paragraph rather than given their own paragraph
- A closing `### Summary` paragraph, which can run longer since it looks back at the whole arc of the phase
- No bullet lists anywhere in this file. No sub-headers other than `### Summary`.
- Every paragraph written as continuous prose with no manually inserted line breaks — this is a project-wide rule from `CLAUDE.md` §5.10, and this file is pure prose, so it's the highest-risk file for that habit to show up. Let it wrap naturally.

Voice: written for a future reader coming back cold, explaining what changed in the system's behavior and why a call was made the way it was — not a commit log read back as prose. If a phase's section is running past roughly four to six paragraphs plus the Summary, that's a sign to compress around the real throughlines rather than transcribing session-by-session.

Write this directly to `build-log.md` — no draft shown in chat first. The phase-end summary in Step 6 is where the user actually reviews this material.

## Step 5 — Generate the PR description and open the PR

Push the phase branch. Then open the PR against `main` using the GitHub CLI (`gh pr create`) — don't just draft a description and hand it to the user to paste in; actually create the PR.

PR title: `Phase N — Short name: one-line summary of what the phase built`

PR body, in this order:

**Summary** — one short paragraph on what this phase built and why it matters.

**What's in this PR** — grouped by logical area, not by commit. One bullet per meaningful piece of work.

**Decisions** — every D-numbered decision from Step 3, one line each, including flagged judgment calls.

**Testing** — what was verified and how, and what's intentionally deferred and why.

**Notes** — anything else worth flagging: known limitations, things to watch in the next phase.

Do not merge the PR. That's the user's call.

## Step 6 — Give the phase-end summary in chat

Four things, in this order, in the chat itself (not just in the PR):

1. **Plain-English summary** — what the system can do now that it couldn't before, written in prose, no bullets, for someone who understands software but wasn't watching the build happen. Same voice as the build-log entry.
2. **Any judgment calls made without a check-in** — surface these clearly here even though they're also in `decisions.md`; this is the part of the summary that most needs real scrutiny, so don't bury it in the commit list.
3. **Commits on the phase branch** — one line each, type and title only.
4. **What's next** — name the next phase, or ask if `plan.md`'s ordering should change. Fold in a specific testing recommendation here too (e.g. "confirm a group of 3 can complete a full round with the deadline auto-advancing on a miss") rather than a generic "test the app."

Once this is delivered, the phase is closed. The next session starts fresh, with `phase-opener`.