-- Phase 1 — Full database schema for Callout.
-- Builds the complete data model upfront (MVP and every post-MVP feature already specified) so later phases activate logic against existing fields instead of migrating schema. Source of truth: docs/planning-reference/callout-planning-doc.md §3 and decisions.md.
-- This migration is the documentation of record for the schema (CLAUDE.md §8).

-- ---------------------------------------------------------------------------
-- Private schema for helper functions that must not be exposed as PostgREST RPC endpoints (only `public` is in the API's exposed schemas per supabase/config.toml).
-- ---------------------------------------------------------------------------
create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Enums. Postgres labels use snake_case; docs may hyphenate (e.g. "out-eliminated" -> 'out_eliminated', "redo-pending" -> 'redo_pending').
-- ---------------------------------------------------------------------------

-- Act/submission payload kinds (D019: configurable per group, any combination).
create type public.submission_type as enum ('video', 'photo', 'text');

-- Tone spectrum: competitive = elimination on miss, casual = auto-advance, no penalty.
create type public.group_tone as enum ('competitive', 'casual');

-- Who picks the next player: the current player (manual) or the system (random, D011).
create type public.targeting_mode as enum ('manual', 'random');

-- Round cadence (D015): immediate chaining vs. a recurring schedule anchored to the host's timezone at creation.
create type public.round_cadence as enum ('immediate', 'recurring');

create type public.group_status as enum ('setup', 'active', 'paused', 'ended');

-- Membership role and status are two independent fields and are never collapsed (CLAUDE.md §2.4). A player can be role=admin AND status=out_eliminated at once.
create type public.membership_role as enum ('host', 'admin', 'player');
create type public.membership_status as enum ('invited', 'active', 'removed', 'out_eliminated');

create type public.round_status as enum ('in_progress', 'completed', 'force_closed');

-- Turn.status is the relay's position; it is deliberately decoupled from Submission.validation_status (CLAUDE.md §2.5, D016).
create type public.turn_status as enum ('pending', 'submitted', 'missed', 'eliminated', 'redo_pending', 'skipped');

create type public.submission_validation_status as enum ('completed', 'flagged');

-- Notification trigger events per D017. 'nudge' is the one type with no per-user toggle.
create type public.notification_type as enum ('called_out', 'deadline_reminder', 'nudge', 'submission_flagged', 'round_started', 'member_joined', 'group_invited', 'submission_comment');

-- ---------------------------------------------------------------------------
-- profile — app-level user data, 1:1 with auth.users (D023).
-- The planning doc's User is "id, standard auth fields", which Supabase Auth owns; everything app-facing about a user (display name shown in rosters, avatar, per-user notification settings per D017, the anonymization target for D018) needs a public-schema home, so it lives here.
-- ---------------------------------------------------------------------------
create table public.profile (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 50),
  avatar_url text,
  -- Per-user notification toggles, one per D017 trigger event, default on. Nudge is deliberately absent: always on, non-toggleable (D017).
  notify_called_out boolean not null default true,
  notify_deadline_reminder boolean not null default true,
  notify_submission_flagged boolean not null default true,
  notify_round_started boolean not null default true,
  notify_member_joined boolean not null default true,
  notify_group_invited boolean not null default true,
  notify_submission_comment boolean not null default true,
  -- User-configurable reminder timing (D017): how long before deadline_at the deadline-approaching reminder fires.
  reminder_lead_time interval not null default interval '1 hour' check (reminder_lead_time > interval '0'),
  created_at timestamptz not null default now()
);

comment on table public.profile is 'App-level user data 1:1 with auth.users: display identity plus per-user notification settings (D017). Auto-created on signup by private.handle_new_user. D018 account deletion anonymizes this row rather than hard-deleting history.';

-- Auto-create a profile row on signup so Phase 2 auth never has to remember to. SECURITY DEFINER is required because the signing-up user has no privileges on public.profile at trigger time and RLS would otherwise block the insert (CLAUDE.md §6: definer documented).
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profile (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'player'), 50)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- "group" — one relay group and its game settings. Quoted everywhere: GROUP is a reserved word, but the table keeps the data model's name (planning doc §3).
-- ---------------------------------------------------------------------------
create table public."group" (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  host_id uuid not null references public.profile (id),
  -- Which submission payloads the group accepts — any non-empty combination (D019).
  accepted_submission_types public.submission_type[] not null default array['text']::public.submission_type[] check (cardinality(accepted_submission_types) >= 1),
  tone public.group_tone not null default 'casual',
  targeting_mode public.targeting_mode not null default 'manual',
  -- How long a called-out player has to respond. Server-authoritative: Turn.deadline_at is computed from this (CLAUDE.md §2.1).
  per_turn_deadline interval not null check (per_turn_deadline > interval '0'),
  round_cadence public.round_cadence not null default 'immediate',
  -- Recurring cadence storage (D026, implementing D015): the anchor instant, the period length, and the host's IANA timezone captured at creation. The zone name is stored because "every Monday 12:00 AM in that zone" cannot be recomputed across DST transitions from a bare timestamp. All three are null for immediate cadence.
  cadence_anchor timestamptz check ((round_cadence = 'immediate') = (cadence_anchor is null)),
  cadence_interval interval check (((round_cadence = 'immediate') = (cadence_interval is null)) and (cadence_interval is null or cadence_interval > interval '0')),
  cadence_timezone text check ((round_cadence = 'immediate') = (cadence_timezone is null)),
  -- Per-group video cap, up to the system-wide 5-minute ceiling (D019).
  max_video_duration interval not null default interval '5 minutes' check (max_video_duration > interval '0' and max_video_duration <= interval '5 minutes'),
  -- Membership cap (D010): system ceiling of 25. Stored per group so the cap check lives with the group row; RPCs enforce it on join/add.
  max_members smallint not null default 25 check (max_members between 2 and 25),
  status public.group_status not null default 'setup',
  created_at timestamptz not null default now()
);

comment on table public."group" is 'A relay group and its game settings. No fairness_window column: fairness is enforced by querying membership vs. turns-this-round (D008/D014), never a stored counter. Clients never write this table directly (CLAUDE.md §2.2).';

-- ---------------------------------------------------------------------------
-- membership — User <-> Group join table. role and status are independent (CLAUDE.md §2.4).
-- ---------------------------------------------------------------------------
create table public.membership (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public."group" (id) on delete cascade,
  user_id uuid not null references public.profile (id),
  role public.membership_role not null default 'player',
  status public.membership_status not null default 'invited',
  -- When the invite was created vs. when it was accepted; joined_at stays null until acceptance.
  created_at timestamptz not null default now(),
  joined_at timestamptz,
  unique (group_id, user_id)
);

comment on table public.membership is 'Join table between profile and group. role (host/admin/player) and status (invited/active/removed/out_eliminated) are independent and never collapsed (CLAUDE.md §2.4). Admin cap of 3 per group (D010) is enforced in RPCs, not schema, since a partial-count constraint cannot be expressed as an index.';

-- Exactly one host per group (D010).
create unique index membership_one_host_per_group on public.membership (group_id) where role = 'host';
create index membership_user_id_idx on public.membership (user_id);
create index membership_group_status_idx on public.membership (group_id, status);

-- ---------------------------------------------------------------------------
-- round — one rotation through the group. ends_at is only meaningful for recurring cadence (D015 force-close).
-- ---------------------------------------------------------------------------
create table public.round (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public."group" (id) on delete cascade,
  round_number integer not null check (round_number >= 1),
  status public.round_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  -- Server-authoritative round end for recurring cadence (CLAUDE.md §2.1); null for immediate cadence.
  ends_at timestamptz,
  unique (group_id, round_number)
);

comment on table public.round is 'One rotation through the group. status force_closed records a round ended by cadence arrival rather than completion (D015); players never called before a force-close are left untouched (D012).';

-- Rounds are strictly sequential: at most one in-progress round per group.
create unique index round_one_in_progress_per_group on public.round (group_id) where status = 'in_progress';

-- ---------------------------------------------------------------------------
-- turn — one callout: who's on the clock, until when, and how it resolved.
-- ---------------------------------------------------------------------------
create table public.turn (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.round (id) on delete cascade,
  -- Denormalized from round for cheap RLS checks and the auto-advance job's scans.
  group_id uuid not null references public."group" (id) on delete cascade,
  called_out_user_id uuid not null references public.profile (id),
  -- Null when the system picked (random targeting / round-start auto-pick, D011/D015).
  called_by_user_id uuid references public.profile (id),
  -- Server-authoritative deadline (CLAUDE.md §2.1): set from group.per_turn_deadline at creation; clients only render deadline_at minus serverNow().
  deadline_at timestamptz not null,
  status public.turn_status not null default 'pending',
  created_at timestamptz not null default now(),
  -- The planning doc points these at Membership: composite FKs guarantee the referenced users are members of this exact group while keeping user-id column names.
  foreign key (group_id, called_out_user_id) references public.membership (group_id, user_id),
  foreign key (group_id, called_by_user_id) references public.membership (group_id, user_id)
);

comment on table public.turn is 'One callout. status is the relay position (CLAUDE.md §2.5) — a flagged submission reverts it to redo_pending without pausing anyone else (D016). Transitions are RPC/scheduled-job driven and idempotent (CLAUDE.md §2.7); clients never write this table.';

create index turn_round_id_idx on public.turn (round_id);
create index turn_group_id_idx on public.turn (group_id);
-- One live baton at a time: the relay is strictly sequential within a round.
create unique index turn_one_pending_per_round on public.turn (round_id) where status = 'pending';
-- The scheduled auto-advance job scans for expired pending turns (planning doc §6.4).
create index turn_pending_deadline_idx on public.turn (deadline_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- submission — a turn's response payload. validation_status is moderation state, independent of turn.status (CLAUDE.md §2.5).
-- ---------------------------------------------------------------------------
create table public.submission (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references public.turn (id) on delete cascade,
  type public.submission_type not null,
  -- Storage paths, populated from Phase 10 on: up to 10 photos, or exactly 1 video (D019); null for text.
  media_urls text[],
  -- Turn submissions cap at 2,000 chars — distinct from the 280-char comment limit (planning doc §5).
  text_content text check (char_length(text_content) <= 2000),
  submitted_at timestamptz not null default now(),
  validation_status public.submission_validation_status not null default 'completed',
  -- Payload shape must match the declared type.
  check (
    case type
      when 'text' then text_content is not null and media_urls is null
      when 'photo' then media_urls is not null and cardinality(media_urls) between 1 and 10 and text_content is null
      when 'video' then media_urls is not null and cardinality(media_urls) = 1 and text_content is null
    end
  )
);

comment on table public.submission is 'A turn''s response. Multiple rows per turn are allowed by design: a flagged submission (validation_status = flagged, D016) is kept for the record and the redo arrives as a new row.';

create index submission_turn_id_idx on public.submission (turn_id);

-- ---------------------------------------------------------------------------
-- volunteer — hand-raise for "pick me next" and the round-start "who wants to go first" prompt (D011/D015). Reset each round by scoping rows to a round.
-- ---------------------------------------------------------------------------
create table public.volunteer (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.round (id) on delete cascade,
  user_id uuid not null references public.profile (id),
  created_at timestamptz not null default now(),
  unique (round_id, user_id)
);

comment on table public.volunteer is 'A hand-raise within a round. Volunteers are surfaced and prioritized per D014 (sorted to the top in manual mode, weighted sub-pool in random mode) but never restrict manual selection.';

-- ---------------------------------------------------------------------------
-- submission_comment — lightweight, submission-scoped comments/reactions. Deliberately NOT group chat: full messaging is excluded from Callout (planning doc §1).
-- ---------------------------------------------------------------------------
create table public.submission_comment (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submission (id) on delete cascade,
  sender_user_id uuid not null references public.profile (id),
  content text not null check (char_length(content) between 1 and 280),
  created_at timestamptz not null default now()
);

comment on table public.submission_comment is 'Short comment/reaction on a submission, 280-char cap (planning doc §5). The only messaging surface Callout ever gets — group chat is reserved for Circle by design.';

create index submission_comment_submission_id_idx on public.submission_comment (submission_id);

-- ---------------------------------------------------------------------------
-- notification — persisted notification/ping events (D017, D024).
-- Generalized from the planning doc's turn-scoped shape: group_id and recipient_user_id are added, and turn_id is nullable, because D017's trigger list includes non-turn events (round started, member joined, group invited) and RLS needs an explicit recipient to filter per user.
-- ---------------------------------------------------------------------------
create table public.notification (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public."group" (id) on delete cascade,
  -- Null for events not tied to a turn (round_started, member_joined, group_invited).
  turn_id uuid references public.turn (id) on delete cascade,
  recipient_user_id uuid not null references public.profile (id),
  -- Null when automated (deadline reminders, round starts); set for person-initiated events like nudges.
  sent_by uuid references public.profile (id),
  type public.notification_type not null,
  sent_at timestamptz not null default now()
);

comment on table public.notification is 'Persisted notification/ping events, one row per recipient (D017, D024). Serves in-app indicators from Phase 3 and dedup/history for real push in Phase 11. Only the recipient can read a row; writes are system/RPC only.';

create index notification_recipient_idx on public.notification (recipient_user_id, sent_at desc);
create index notification_group_id_idx on public.notification (group_id);
create index notification_turn_id_idx on public.notification (turn_id);

-- ---------------------------------------------------------------------------
-- Realtime: expose the game tables on the supabase_realtime publication now so later phases subscribe without another migration. RLS still gates what each subscriber sees.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public."group", public.membership, public.round, public.turn, public.submission, public.volunteer, public.submission_comment, public.notification;
