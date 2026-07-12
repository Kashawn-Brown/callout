---
name: phase-opener
description: Use this at the start of every fresh Claude Code session on the Callout project, and any time the user says something like "start Phase N," "let's begin the next phase," "kick off phase X," or opens a new session without further context on this repo. Always run this before writing any code or touching any files other than the ones this skill itself reads. This is the standard way every Callout phase begins — do not skip it even if the user's opening message looks like it already states the phase and scope, since this skill's job is to verify that stated scope against the actual source-of-truth files, not just take it on faith.
---

# Phase Opener

Standardizes how every Callout development phase begins: reading the right files in the right order, confirming the phase is genuinely ready to build (front-loaded, per CLAUDE.local.md), and starting straight into the work — no mid-phase pause once this check is done.

## Step 1 — Read, in this exact order

1. `CLAUDE.md` — architecture rules, stack, code standards, hard do-not rules
2. `CLAUDE.local.md` — phase-gated workflow, front-loading rules, phase-end checklist
3. `decisions.md` — every product/architecture decision made so far
4. `timeline.md` — Current Status block, to confirm where the project actually is
5. `plan.md` — full phase list, to find the next phase to work

Do not skip any of these even if this looks like a continuation of recent work. Each phase starts in a fresh session with no conversation memory, by design — the files are the only state that exists.

## Step 2 — Identify the phase to build

Walk `plan.md` from Phase 0 forward. The phase to build is the **first one whose Status line is not "complete."** If that phase's number is greater than 0, confirm the immediately preceding phase's Status line does say complete — phases are strictly sequential, per `CLAUDE.local.md`. If there's a gap (e.g. Phase 3 is marked complete but Phase 2 isn't), stop and flag this to the user before doing anything else — that's a data-integrity problem in `plan.md`, not a normal front-loading gap, and building on top of it would compound the confusion.

State plainly which phase you're about to build and quote its Goal line from `plan.md`.

## Step 3 — Confirm or create the branch

The branch should be `phase/<n>-<short-name>`, matching the phase heading in `plan.md` (e.g. `plan.md`'s "Phase 3 — MVP core loop" becomes `phase/3-mvp-core-loop`). Check the current branch. If it's not already the correct phase branch, create it off `main` (make sure `main` is up to date first) and switch to it. State which branch you're now on.

## Step 4 — Run the front-loading check

This is the one place a pause before building is legitimate — it happens *before* the phase starts, not mid-phase, so it doesn't violate the phase-gated model in `CLAUDE.local.md`.

For the phase identified in Step 2, go through its `plan.md` entry — Goal, every checklist bullet, Out of scope, Done when — and for each item ask: is this fully answered by something in `decisions.md`, or is it self-evidently an implementation detail with no real ambiguity? Pay particular attention to:

- Any bullet with a `(D0xx)` tag — confirm that decision entry actually exists and actually covers what the bullet needs, don't just trust the tag is correct
- Any bullet *without* a `(D0xx)` tag that references a rule, algorithm, or edge case (fairness enforcement, elimination timing, cadence math, moderation behavior, notification triggers) — these should almost always trace back to a decision; if one doesn't, that's worth double-checking against the planning document (`docs/planning-reference/callout-planning-doc.md`) before assuming it's just an implementation detail
- Any new dependency the phase will plausibly need (e.g. camera/video libraries in Phase 10, push notification libraries in Phase 11) — per `CLAUDE.md` §10, these need to be either already decided or explicitly left to your judgment; if genuinely unclear, that's a front-loading gap

**If everything checks out:** say so briefly, then move straight to Step 5. Don't manufacture a check-in here just to be thorough — a clean front-loading check should be fast.

**If something is genuinely missing:** don't guess and don't proceed. Stop, and tell the user specifically what's missing and why it matters for this phase — for example, "Phase 6's fairness-window bullet is tagged D014, but D014 only covers manual-mode fairness, not what happens when the volunteer pool is empty in random mode. That's not written down anywhere I can find. I'd rather you resolve this before I start building the random targeting RPC than guess at it." This is different from the mid-phase "wasn't front-loaded anyway" case in `CLAUDE.local.md` — that one lets you make a judgment call and keep going since the phase is already underway. This one is a pre-flight check where stopping costs nothing, so there's no reason to guess when you could just ask.

## Step 5 — State the phase plan and begin

Once the front-loading check is clean, tell the user, in one message:

1. What branch you're on
2. This phase's scope, in your own words, drawing from `plan.md`'s Goal and checklist
3. What this phase explicitly is NOT building, from `plan.md`'s Out of scope line
4. What the first concrete piece of work is, and roughly what it produces

Then **begin the work immediately** — do not end your turn waiting for a "go ahead." This is the one structural difference from how Shot O'Clock's equivalent prompt worked: there, the phase paused here for a human "confirm" before any code was written. Callout doesn't pause here. The front-loading check in Step 4 is the confirmation — if it passed, the phase is cleared to run all the way to its Done-when criteria without further check-ins, per `CLAUDE.local.md`.

From here forward, follow `CLAUDE.md` and `CLAUDE.local.md` for everything else, including the `phase-closer` skill once the phase's Done-when criteria are met.