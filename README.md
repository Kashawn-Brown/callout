# Callout

Callout is a chain-challenge relay game for friend groups. One player completes a challenge — a workout check-in, a photo prompt, a quick update — then calls out the next person, who has a fixed window to respond before the game moves on without them. It's a social rules engine for keeping group challenges alive: the chain keeps moving on its own, nobody can be dogpiled with repeat callouts, and missing your turn has exactly the consequences the group signed up for.

I designed and built the project end-to-end — the product spec, the data model, the game rules, and the phased build plan — and use AI-assisted development as the implementation tool inside that structure. Every product and architecture decision in this repo is mine; the full decision history lives in a running log that has tracked each call, and each reversal, since planning.

## Status

Callout is mid-development and not yet released. The foundation phases are complete and verified; the feature phases on top of them are planned in full but not yet built.

**Working today, end to end:**

- Real accounts (email/password or phone + SMS code), persistent sessions, and a profile with an editable name, a shareable Callout ID, and a pickable avatar color
- The core relay loop: create a group, invite people, start the game, submit a text response, hand off to the next player — with expired turns resolved server-side by a scheduled job, no client awake required
- A fairness rule that structurally prevents anyone being called twice in a round before everyone has gone
- A connections system (exact-ID lookup only — no browsing, no fuzzy search of the user base) and a persistent per-group join code: instant entry before a game starts, host-approved requests once it's running
- Live game state over Postgres change streams, with countdowns rendered from server time

**Planned and specified, not yet built:** random targeting and volunteering, competitive mode with elimination, admin roles and host transfer, recurring round schedules and active-hours windows, moderation and comments, photo/video challenges, real push notifications, and app-store release. The spec for all of it was closed before the build started — nothing ahead is an open question, just unbuilt.

## How a game works

A host creates a group, sets the response deadline (30 minutes to 7 days), and adds people — from their connections, by exact Callout ID, or by sharing the group code. Once the game starts, the relay is a baton: whoever holds it submits their response and picks who's next from the players who haven't gone this round. Submitting opens a fixed five-minute pick window; if the pick never comes, the server picks randomly so the chain never stalls on one person. When everyone has gone, the round closes and the next one opens immediately. In the current casual mode a missed deadline just moves the chain along; competitive mode, where a miss eliminates you, is a later phase.

## Tech stack

- **Mobile:** React Native + Expo (TypeScript, Expo Router)
- **Backend:** Supabase — Postgres, Row Level Security, Realtime, Auth, and `pg_cron` for scheduled game transitions
- **Game logic:** PL/pgSQL functions exposed as RPCs; the client never writes game tables directly
- **Testing:** pgTAP suites (200+ tests) covering access rules and the full RPC surface, plus end-to-end scripts that drive the real API through multi-account game scenarios

## Architecture

A few decisions carry most of the design:

- **The server owns every clock.** Clients never run an authoritative timer — turn deadlines live in the database, countdowns render as `deadline_at` minus a synced server time, and a `pg_cron` job resolves expired turns, hands off stalled picks, and rolls rounds over. A relay game dies the moment "your turn expired" depends on someone's phone being awake, so I put deadline enforcement where it can't be paused, backgrounded, or clock-drifted.

- **Game rules live in Postgres, behind RLS.** Every state change — create, invite, join, submit, call out, skip, remove, approve — is a `SECURITY DEFINER` function that validates identity, membership, and game state before touching a row. Clients hold zero write privileges on game tables (enforced at the privilege layer, not just by policy), and Row Level Security means a non-member can't read a group's data at all. I chose this over an app server because it makes the rules exactly as trustworthy as the database, with one fewer deployment to run.

- **Fairness is computed, never stored.** "Nobody goes twice before everyone has gone" is enforced by querying membership against the turns already taken this round — there's no counter to drift out of sync, and no override path exists in any targeting mode.

- **Transitions are idempotent by construction.** Every turn or round transition serializes on a lock of the group row and re-checks state after acquiring it, so two clients racing each other — or a client racing the scheduled job — collapse into one winner and a no-op. Partial unique indexes (one pending turn per round, one in-progress round per group) backstop the locks.

- **The schema was built complete before the features were.** All tables and enums for every planned feature — elimination, moderation, media, cadence — landed in one early migration, so later phases activate logic against existing fields instead of migrating shape. The columns for features that don't exist yet are deliberate, not dead.

- **Discovery is deliberate.** There is no way to browse or fuzzy-search the user base: you're findable only by the exact Callout ID you chose to hand out, name search never leaves your own connections, and group entry runs through a permanent join code with host approval once a game is live. I'd rather the social graph grow through real-world sharing than in-app discovery.

## Running locally

Prerequisites: Node LTS, Docker, the [Supabase CLI](https://supabase.com/docs/guides/cli), and [Expo Go](https://expo.dev/go) on a phone or simulator.

```bash
git clone https://github.com/Kashawn-Brown/callout.git
cd callout
npm install

# Start the local Supabase stack (Postgres, Auth, Realtime — runs on the 5434x port range)
supabase start

# Point the app at it: copy .env.example to .env and fill in the URL and
# publishable key that `supabase start` prints
cp .env.example .env

# Run the app
npx expo start
```

Scan the QR code with Expo Go. For a physical device, use your machine's LAN IP in `.env` instead of `127.0.0.1`. Phone auth works locally without an SMS provider via a test-OTP map baked into the Supabase config (test numbers `+1 500 555 0001–0003`, code `123456`).

Checks:

```bash
npm run test:db     # pgTAP suites against the local database
npm run typecheck   # strict TypeScript
npm run lint        # ESLint
```

## Development approach

The project runs on a phase-gated plan: a full specification pass closed every product and architecture question up front, and the build proceeds one fully-specified phase at a time, each ending in a reviewed, working result on its own branch and PR. I make every product and architecture call and review each phase against the spec; AI tooling does the implementation inside those boundaries — it executes the plan, it doesn't steer it. Decisions and their reversals are logged as numbered entries at the moment they're made, so the reasoning trail survives the code it produced. That trail isn't just a record of what worked: an early identity-system design turned out to be wrong and cost a real correction pass, and the decision log shows the mistake, the reasoning for the fix, and the decisions it superseded, rather than a rewritten history.
