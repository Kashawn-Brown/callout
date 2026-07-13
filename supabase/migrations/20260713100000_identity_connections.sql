-- Phase 3B — Identity & Connections: shareable short IDs (D032), the closed connections graph (D033/D034/D038/D039), single-use share invites (D036), connection-scoped group invites replacing open search (D035), and the dedicated post-submission pick window (D042).
-- Follows the Phase 3 conventions: all mutations are SECURITY DEFINER RPCs raising structured errors via private.raise_app_error; clients only read tables through RLS and call RPCs (CLAUDE.md §2.2).

-- gen_random_bytes for short IDs and share tokens lives in pgcrypto (gen_random_uuid is core, random bytes are not).
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Code generation helpers.
-- ---------------------------------------------------------------------------

-- Human-shareable random code: uppercase alphanumerics minus the lookalikes (0/O, 1/I/L), so codes survive being read aloud or hand-typed (D032). 31^8 ≈ 8.5e11 for short IDs and 31^16 ≈ 7e23 for share tokens — high-entropy and non-sequential at this project's scale (D005), so neither can be guessed by incrementing or brute-forcing.
create function private.random_code(code_length integer)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  c_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code text := '';
  i integer;
begin
  v_bytes := extensions.gen_random_bytes(code_length);
  for i in 0 .. code_length - 1 loop
    -- Modulo bias across 31 symbols is negligible for uniqueness/guessability at this entropy.
    v_code := v_code || substr(c_alphabet, (get_byte(v_bytes, i) % 31) + 1, 1);
  end loop;
  return v_code;
end;
$$;

-- Collision-checked short ID for profile rows. SECURITY DEFINER because it runs as a column default under whatever role is inserting (the signup trigger, a migration) and must read profile past RLS to test uniqueness (CLAUDE.md §6).
create function private.unique_short_id()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_candidate text;
begin
  loop
    v_candidate := private.random_code(8);
    exit when not exists (select 1 from public.profile p where p.short_id = v_candidate);
  end loop;
  return v_candidate;
end;
$$;

-- ---------------------------------------------------------------------------
-- profile.short_id (D032): the shareable identity handle, distinct from the auth UUID. The volatile default is evaluated per existing row during the ALTER, so current users are backfilled with distinct IDs in the same statement.
-- ---------------------------------------------------------------------------

-- Added nullable, backfilled row by row, then locked down — rather than a volatile default evaluated inside the ADD COLUMN rewrite, whose visibility of the half-built column is murkier than an ordinary UPDATE.
alter table public.profile add column short_id text;
update public.profile set short_id = private.unique_short_id() where short_id is null;
alter table public.profile alter column short_id set not null;
alter table public.profile alter column short_id set default private.unique_short_id();
alter table public.profile add constraint profile_short_id_unique unique (short_id);
alter table public.profile add constraint profile_short_id_format check (short_id ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$');

comment on column public.profile.short_id is 'Shareable short user ID (D032): high-entropy, non-sequential, meant to be copied and shared out-of-band as the primary way to be found (D033). Never client-writable — the update grant below is column-scoped to exclude it.';

-- ---------------------------------------------------------------------------
-- connection — the closed friend graph (D033/D038/D039). One row per pair, canonicalized by uuid order so a pair can never appear twice in opposite orientations. Independent of group membership: removing a connection touches no group, and leaving a group touches no connection (D038).
-- ---------------------------------------------------------------------------

create table public.connection (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.profile (id) on delete cascade,
  user_b_id uuid not null references public.profile (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_a_id < user_b_id),
  unique (user_a_id, user_b_id)
);

comment on table public.connection is 'A mutual connection between two users, one canonical row per pair (user_a_id < user_b_id). Created instantly with no accept step (D033), by auto-connect on shared group membership (D039), or by share-invite claim (D036). Clients never write it directly.';

create index connection_user_b_idx on public.connection (user_b_id);

-- Once-per-pair-per-group ledger for D039: auto-connect fires at the moment shared membership begins for a specific pair in a specific group, and never again for that pair+group — so a removed connection stays removed while both remain in that group, but a later, different shared group reconnects them. Lives in private: pure mechanism, never client-visible.
create table private.connection_event (
  group_id uuid not null references public."group" (id) on delete cascade,
  user_a_id uuid not null references public.profile (id) on delete cascade,
  user_b_id uuid not null references public.profile (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_a_id, user_b_id),
  check (user_a_id < user_b_id)
);

-- ---------------------------------------------------------------------------
-- share_invite — single-use, one-inviter-one-group tokens (D036).
-- ---------------------------------------------------------------------------

create table public.share_invite (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default private.random_code(16),
  group_id uuid not null references public."group" (id) on delete cascade,
  inviter_user_id uuid not null references public.profile (id),
  created_at timestamptz not null default now(),
  -- Consumed exactly once: set atomically by claim_share_invite; a non-null value means the token is dead for everyone else (D036).
  consumed_at timestamptz,
  consumed_by_user_id uuid references public.profile (id)
);

comment on table public.share_invite is 'Single-use share-invite token (D036), tied to one inviter and one destination group. Claiming it joins the claimant to the group and connects them with the inviter in the same action; the token dies on first claim.';

create index share_invite_group_id_idx on public.share_invite (group_id);

-- ---------------------------------------------------------------------------
-- Connection helpers.
-- ---------------------------------------------------------------------------

-- Order-insensitive existence check for RPC validation paths (runs inside definer RPCs, so no definer of its own).
create function private.are_connected(user_one uuid, user_two uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.connection c
    where c.user_a_id = least(user_one, user_two)
      and c.user_b_id = greatest(user_one, user_two)
  );
$$;

-- RLS predicate: is the current user connected with the target? SECURITY DEFINER for the same reason as the Phase 1 helpers — policy expressions run with the querying role's privileges and must not recurse into RLS.
create function private.is_connected_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.are_connected((select auth.uid()), target_user_id);
$$;

-- Canonicalized insert, idempotent by design: re-connecting an existing pair is a no-op, which lets D033 adds, the D039 trigger, and D036 claims all call this without coordinating.
create function private.connect_users(user_one uuid, user_two uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.connection (user_a_id, user_b_id)
  select least(user_one, user_two), greatest(user_one, user_two)
  where user_one is distinct from user_two
  on conflict (user_a_id, user_b_id) do nothing;
$$;

-- ---------------------------------------------------------------------------
-- D039 — auto-connect on shared group membership. Fires when a membership becomes active (group creation, invite acceptance, share-invite claim, or reinstatement); the connection_event ledger reduces it to exactly once per pair per group, so reinstatements and rejoins never resurrect a deliberately removed connection.
-- ---------------------------------------------------------------------------

create function private.handle_membership_activated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Pair the newly active member with everyone currently in the group (active or eliminated — eliminated players are still members, D012). Only pairs whose ledger insert lands are connected, implementing once-per-pair-per-group (D039).
  with pairs as (
    select new.group_id as group_id,
           least(new.user_id, m.user_id) as user_a_id,
           greatest(new.user_id, m.user_id) as user_b_id
    from public.membership m
    where m.group_id = new.group_id
      and m.user_id <> new.user_id
      and m.status in ('active', 'out_eliminated')
  ),
  fired as (
    insert into private.connection_event (group_id, user_a_id, user_b_id)
    select p.group_id, p.user_a_id, p.user_b_id from pairs p
    on conflict do nothing
    returning user_a_id, user_b_id
  )
  insert into public.connection (user_a_id, user_b_id)
  select f.user_a_id, f.user_b_id from fired f
  on conflict (user_a_id, user_b_id) do nothing;

  return new;
end;
$$;

create trigger on_membership_activated
  after insert or update of status on public.membership
  for each row
  when (new.status = 'active')
  execute function private.handle_membership_activated();

-- ---------------------------------------------------------------------------
-- Connection RPCs (D033/D038).
-- ---------------------------------------------------------------------------

-- Add by exact short ID. Unlike the email path, a miss is reported honestly: short IDs are high-entropy and non-enumerable (D032), so "not found" leaks nothing useful. Adding completes instantly with no accept step (D033).
create function public.add_connection_by_short_id(short_id_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_code text;
  v_target public.profile;
  v_already boolean;
begin
  v_uid := private.assert_authenticated();
  v_code := upper(btrim(coalesce(short_id_code, '')));

  if v_code = '' then
    perform private.raise_app_error('invalid_input', 'Enter a Callout ID.');
  end if;

  select * into v_target from public.profile p where p.short_id = v_code;
  if not found then
    perform private.raise_app_error('short_id_not_found', 'No one was found with that ID. Double-check it and try again.');
  end if;
  if v_target.id = v_uid then
    perform private.raise_app_error('invalid_input', 'That is your own ID.');
  end if;

  v_already := private.are_connected(v_uid, v_target.id);
  perform private.connect_users(v_uid, v_target.id);

  return jsonb_build_object(
    'user_id', v_target.id,
    'display_name', v_target.display_name,
    'avatar_url', v_target.avatar_url,
    'already_connected', v_already
  );
end;
$$;

-- Add by exact email. Always returns the same generic response whether or not the email matches an account, so the platform's account list cannot be enumerated through this surface (D033) — on a match the connection simply appears in the caller's list.
create function public.add_connection_by_email(email_address text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_email text;
  v_target_id uuid;
begin
  v_uid := private.assert_authenticated();
  v_email := lower(btrim(coalesce(email_address, '')));

  if v_email = '' or position('@' in v_email) = 0 then
    perform private.raise_app_error('invalid_input', 'Enter an email address.');
  end if;

  select u.id into v_target_id
  from auth.users u
  join public.profile p on p.id = u.id
  where lower(u.email) = v_email
    and u.id <> v_uid;

  if v_target_id is not null then
    perform private.connect_users(v_uid, v_target_id);
  end if;

  -- Identical shape for match, no-match, and self-match: the enumeration guarantee lives here (D033).
  return jsonb_build_object('status', 'processed');
end;
$$;

-- Remove a connection (D038): independent of any shared group, not a block, and idempotent — removing an already-absent connection is a success, not an error, since the end state is identical.
create function public.remove_connection(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := private.assert_authenticated();

  delete from public.connection c
  where c.user_a_id = least(v_uid, target_user_id)
    and c.user_b_id = greatest(v_uid, target_user_id);

  return jsonb_build_object('status', 'removed');
end;
$$;

-- ---------------------------------------------------------------------------
-- Share-invite RPCs (D036).
-- ---------------------------------------------------------------------------

-- Generate a share-invite token. Host-only for now, matching invite_player's Phase 3 permission scope; Phase 5 widens both to admins together (D013).
create function public.create_share_invite(target_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group public."group";
  v_invite public.share_invite;
begin
  v_uid := private.assert_authenticated();
  v_group := private.lock_group(target_group_id);

  if v_group.host_id <> v_uid then
    perform private.raise_app_error('not_host', 'Only the host can create invite links.');
  end if;
  if v_group.status = 'ended' then
    perform private.raise_app_error('group_ended', 'This group has ended.');
  end if;

  insert into public.share_invite (group_id, inviter_user_id)
  values (v_group.id, v_uid)
  returning * into v_invite;

  return jsonb_build_object('share_invite_id', v_invite.id, 'token', v_invite.token);
end;
$$;

-- Read-only look at a token so the claim screen can show what is being joined before committing. Exact-token lookup only — tokens are non-enumerable (D036).
create function public.preview_share_invite(invite_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_invite public.share_invite;
  v_group public."group";
  v_inviter_name text;
  v_member_count integer;
begin
  perform private.assert_authenticated();

  select * into v_invite from public.share_invite si where si.token = upper(btrim(coalesce(invite_token, '')));
  if not found then
    perform private.raise_app_error('share_invite_not_found', 'That invite link is not valid.');
  end if;

  select * into v_group from public."group" g where g.id = v_invite.group_id;
  select p.display_name into v_inviter_name from public.profile p where p.id = v_invite.inviter_user_id;
  select count(*) into v_member_count
  from public.membership m
  where m.group_id = v_group.id and m.status in ('active', 'out_eliminated');

  return jsonb_build_object(
    'group_id', v_group.id,
    'group_name', v_group.name,
    'inviter_name', v_inviter_name,
    'member_count', v_member_count,
    'status', case when v_invite.consumed_at is null and v_group.status <> 'ended' then 'valid' else 'used' end
  );
end;
$$;

-- Claim a share-invite: consume the token, join the group as an active member, and connect with the inviter — one action (D036). The claimant signed up through a link the host generated, so no separate accept step exists; membership goes straight to active, exactly like an accepted invite.
create function public.claim_share_invite(invite_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_invite public.share_invite;
  v_group public."group";
  v_membership public.membership;
  v_has_membership boolean;
  v_member_count integer;
  v_result jsonb;
begin
  v_uid := private.assert_authenticated();

  select * into v_invite from public.share_invite si where si.token = upper(btrim(coalesce(invite_token, '')));
  if not found then
    perform private.raise_app_error('share_invite_not_found', 'That invite link is not valid.');
  end if;

  v_group := private.lock_group(v_invite.group_id);
  -- Re-read under the group lock: two claimants racing the same token serialize here, and the second sees it consumed.
  select * into v_invite from public.share_invite si where si.id = v_invite.id;

  if v_invite.consumed_at is not null then
    if v_invite.consumed_by_user_id = v_uid then
      -- The claimant retrying their own successful claim is a no-op, not an error (CLAUDE.md §2.7).
      return jsonb_build_object('status', 'joined', 'group_id', v_group.id);
    end if;
    perform private.raise_app_error('share_invite_used', 'That invite link has already been used.');
  end if;
  if v_group.status = 'ended' then
    perform private.raise_app_error('group_ended', 'This group has ended.');
  end if;

  select * into v_membership from public.membership m
  where m.group_id = v_group.id and m.user_id = v_uid;
  v_has_membership := found;

  if v_has_membership and v_membership.status in ('active', 'out_eliminated') then
    perform private.raise_app_error('already_member', 'You are already a member of this group.');
  end if;

  select count(*) into v_member_count
  from public.membership m
  where m.group_id = v_group.id and m.status in ('invited', 'active', 'out_eliminated');

  -- Joining adds a member to the cap count; flipping an existing pending invite to active does not.
  if (not v_has_membership or v_membership.status <> 'invited') and v_member_count + 1 > v_group.max_members then
    perform private.raise_app_error('group_full', 'This group is full.');
  end if;

  update public.share_invite
  set consumed_at = now(), consumed_by_user_id = v_uid
  where id = v_invite.id;

  if v_has_membership then
    -- Covers a pending invite (accepted implicitly by claiming) and a removed member re-entering through a link the host generated.
    update public.membership
    set status = 'active', role = 'player', joined_at = now()
    where id = v_membership.id;
  else
    insert into public.membership (group_id, user_id, role, status, joined_at)
    values (v_group.id, v_uid, 'player', 'active', now());
  end if;

  -- The activation trigger already connected the claimant with current co-members; this explicit call guarantees the inviter connection even when the D039 ledger says that pair+group already fired (e.g. the inviter was re-claimed after a removal) — D036 promises inviter auto-connect unconditionally.
  perform private.connect_users(v_uid, v_invite.inviter_user_id);

  insert into public.notification (group_id, recipient_user_id, sent_by, type)
  select v_group.id, m.user_id, v_uid, 'member_joined'
  from public.membership m
  where m.group_id = v_group.id and m.status = 'active' and m.user_id <> v_uid;

  v_result := jsonb_build_object('status', 'joined', 'group_id', v_group.id);
  if v_group.status = 'paused' then
    -- Same auto-resume as respond_to_invite (D029): the new member may make the relay viable again.
    v_result := v_result || private.open_round(v_group);
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- D035 — group invites draw from connections; the open search RPC is retired. create_group and invite_player now require every invitee to be an existing connection of the caller, enforcing the closed model server-side rather than trusting the picker UI.
-- ---------------------------------------------------------------------------

drop function public.search_profiles(text);

create or replace function public.create_group(group_name text, deadline_minutes integer, invitee_ids uuid[] default array[]::uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_name text;
  v_invitees uuid[];
  v_group_id uuid;
begin
  v_uid := private.assert_authenticated();
  v_name := btrim(coalesce(group_name, ''));

  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    perform private.raise_app_error('invalid_input', 'Group name must be between 1 and 80 characters.');
  end if;

  if deadline_minutes is null or deadline_minutes < 5 or deadline_minutes > 10080 then
    perform private.raise_app_error('invalid_input', 'Response deadline must be between 5 minutes and 7 days.');
  end if;

  select coalesce(array_agg(distinct candidate), array[]::uuid[]) into v_invitees
  from unnest(coalesce(invitee_ids, array[]::uuid[])) as candidate
  where candidate is not null and candidate <> v_uid;

  if (select count(*) from public.profile p where p.id = any (v_invitees)) <> cardinality(v_invitees) then
    perform private.raise_app_error('user_not_found', 'One of the invited users does not exist.');
  end if;

  -- Invitees must come from the creator's connections (D035): the picker only offers connections, and the server holds the same line.
  if exists (select 1 from unnest(v_invitees) as invitee where not private.are_connected(v_uid, invitee)) then
    perform private.raise_app_error('not_connected', 'You can only invite people from your connections.');
  end if;

  -- Host counts toward the D010 cap of 25.
  if cardinality(v_invitees) + 1 > 25 then
    perform private.raise_app_error('group_full', 'A group can have at most 25 members including the host.');
  end if;

  insert into public."group" (name, host_id, per_turn_deadline)
  values (v_name, v_uid, make_interval(mins => deadline_minutes))
  returning id into v_group_id;

  insert into public.membership (group_id, user_id, role, status, joined_at)
  values (v_group_id, v_uid, 'host', 'active', now());

  insert into public.membership (group_id, user_id, role, status)
  select v_group_id, invitee, 'player', 'invited'
  from unnest(v_invitees) as invitee;

  insert into public.notification (group_id, recipient_user_id, sent_by, type)
  select v_group_id, invitee, v_uid, 'group_invited'
  from unnest(v_invitees) as invitee;

  return jsonb_build_object('group_id', v_group_id);
end;
$$;

create or replace function public.invite_player(target_group_id uuid, target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group public."group";
  v_membership public.membership;
  v_membership_id uuid;
  v_member_count integer;
begin
  v_uid := private.assert_authenticated();
  v_group := private.lock_group(target_group_id);

  if v_group.host_id <> v_uid then
    perform private.raise_app_error('not_host', 'Only the host can invite players.');
  end if;
  if v_group.status = 'ended' then
    perform private.raise_app_error('group_ended', 'This group has ended.');
  end if;
  if target_user_id = v_uid then
    perform private.raise_app_error('invalid_input', 'You are already in this group.');
  end if;
  if not exists (select 1 from public.profile p where p.id = target_user_id) then
    perform private.raise_app_error('user_not_found', 'That user does not exist.');
  end if;

  -- Direct invites are connection-only (D035); someone outside the inviter's connections arrives via a share-invite link instead (D036).
  if not private.are_connected(v_uid, target_user_id) then
    perform private.raise_app_error('not_connected', 'You can only invite people from your connections.');
  end if;

  select count(*) into v_member_count
  from public.membership m
  where m.group_id = v_group.id and m.status in ('invited', 'active', 'out_eliminated');

  if v_member_count + 1 > v_group.max_members then
    perform private.raise_app_error('group_full', 'This group is full.');
  end if;

  select * into v_membership from public.membership m
  where m.group_id = v_group.id and m.user_id = target_user_id;

  if found then
    if v_membership.status in ('active', 'out_eliminated') then
      perform private.raise_app_error('already_member', 'That user is already a member.');
    elsif v_membership.status = 'invited' then
      perform private.raise_app_error('already_invited', 'That user already has a pending invite.');
    else
      -- Re-inviting a removed player starts them over as an invited regular player.
      update public.membership
      set status = 'invited', role = 'player', created_at = now(), joined_at = null
      where id = v_membership.id
      returning id into v_membership_id;
    end if;
  else
    insert into public.membership (group_id, user_id, role, status)
    values (v_group.id, target_user_id, 'player', 'invited')
    returning id into v_membership_id;
  end if;

  insert into public.notification (group_id, recipient_user_id, sent_by, type)
  values (v_group.id, target_user_id, v_uid, 'group_invited');

  return jsonb_build_object('membership_id', v_membership_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- D042 — dedicated pick window, amending D029's shared submit-then-pick deadline. The turn's original deadline now governs the act alone; the moment the act is submitted, deadline_at is overwritten with a fixed five-minute window governing picking alone. The scheduled job's existing submitted-past-deadline branch fires the auto-random fallback against this shorter window with no changes of its own.
-- ---------------------------------------------------------------------------

create or replace function public.submit_turn(target_turn_id uuid, submission_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Fixed system-wide pick window, deliberately not host-configurable (D042).
  c_pick_window constant interval := interval '5 minutes';
  v_uid uuid;
  v_turn public.turn;
  v_group public."group";
  v_round public.round;
  v_submission_id uuid;
  v_pick_deadline timestamptz;
begin
  v_uid := private.assert_authenticated();

  select * into v_turn from public.turn t where t.id = target_turn_id;
  if not found then
    perform private.raise_app_error('turn_not_found', 'Turn not found.');
  end if;

  v_group := private.lock_group(v_turn.group_id);
  -- Re-read under the group lock: the job or another action may have resolved this turn in the meantime.
  select * into v_turn from public.turn t where t.id = target_turn_id;
  select * into v_round from public.round r where r.id = v_turn.round_id;

  if v_turn.called_out_user_id <> v_uid then
    perform private.raise_app_error('not_your_turn', 'This is not your turn.');
  end if;
  -- Removed players cannot act (CLAUDE.md §2.3).
  if not exists (select 1 from public.membership m where m.group_id = v_group.id and m.user_id = v_uid and m.status = 'active') then
    perform private.raise_app_error('not_a_member', 'You are not an active member of this group.');
  end if;
  if v_round.status <> 'in_progress' then
    perform private.raise_app_error('round_closed', 'This round is over.');
  end if;
  if v_turn.status <> 'pending' then
    perform private.raise_app_error('turn_not_pending', 'This turn has already been resolved.');
  end if;
  if now() > v_turn.deadline_at then
    perform private.raise_app_error('deadline_passed', 'The deadline for this turn has passed.');
  end if;
  if not ('text' = any (v_group.accepted_submission_types)) then
    perform private.raise_app_error('type_not_accepted', 'This group does not accept text submissions.');
  end if;
  if submission_text is null or char_length(btrim(submission_text)) < 1 then
    perform private.raise_app_error('invalid_input', 'Submission text is required.');
  end if;
  if char_length(submission_text) > 2000 then
    perform private.raise_app_error('invalid_input', 'Submissions are limited to 2,000 characters.');
  end if;

  insert into public.submission (turn_id, type, text_content)
  values (v_turn.id, 'text', submission_text)
  returning id into v_submission_id;

  if private.count_eligible(v_round.id) = 0 then
    -- Last eligible player: no hand-off exists, so no pick window either — the round completes immediately.
    update public.turn set status = 'submitted' where id = v_turn.id;
    return jsonb_build_object('submission_id', v_submission_id, 'handoff_required', false)
      || private.complete_round_and_rollover(v_round.id, v_group);
  end if;

  -- The D042 overwrite: from here on deadline_at means "pick by", not "act by". Applied unconditionally — even when the act deadline had more than five minutes left — because the pick window is fixed, not a remainder.
  v_pick_deadline := now() + c_pick_window;
  update public.turn set status = 'submitted', deadline_at = v_pick_deadline where id = v_turn.id;

  return jsonb_build_object(
    'submission_id', v_submission_id,
    'handoff_required', true,
    'pick_deadline_at', v_pick_deadline
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS for the new tables. profile's select policy widens to connections so the connections list can render names without any group in common (D033/D034); its update grant narrows to the self-editable columns so short_id stays server-owned.
-- ---------------------------------------------------------------------------

alter table public.connection enable row level security;
alter table public.share_invite enable row level security;

create policy connection_select_participant on public.connection
  for select to authenticated
  using (user_a_id = (select auth.uid()) or user_b_id = (select auth.uid()));

-- Only the inviter sees their own outstanding tokens; everyone else goes through preview/claim by exact token.
create policy share_invite_select_inviter on public.share_invite
  for select to authenticated
  using (inviter_user_id = (select auth.uid()));

drop policy profile_select_self_or_groupmate on public.profile;
create policy profile_select_self_groupmate_or_connection on public.profile
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_group_with(id) or private.is_connected_with(id));

-- Explicit privilege posture, stated identically for local and hosted (the Phase 3 lesson): reads through RLS, no client writes anywhere new, and profile updates constrained to the columns a user actually owns — short_id is excluded so the RLS update policy alone can never let a client rewrite their handle.
revoke all on public.connection, public.share_invite from anon, authenticated;
grant select on public.connection, public.share_invite to authenticated;

revoke update on public.profile from anon, authenticated;
grant update (display_name, avatar_url, notify_called_out, notify_deadline_reminder, notify_submission_flagged, notify_round_started, notify_member_joined, notify_group_invited, notify_submission_comment, reminder_lead_time) on public.profile to authenticated;

-- Realtime: connection rows on the publication now so the connections list can go live later without another migration; RLS still gates what each subscriber sees.
alter publication supabase_realtime add table public.connection;

-- ---------------------------------------------------------------------------
-- Function privileges, following the Phase 3 convention: the RPC surface is authenticated-only, private helpers are unreachable by API roles.
-- ---------------------------------------------------------------------------

revoke execute on function public.add_connection_by_short_id(text) from public, anon;
revoke execute on function public.add_connection_by_email(text) from public, anon;
revoke execute on function public.remove_connection(uuid) from public, anon;
revoke execute on function public.create_share_invite(uuid) from public, anon;
revoke execute on function public.preview_share_invite(text) from public, anon;
revoke execute on function public.claim_share_invite(text) from public, anon;

grant execute on function public.add_connection_by_short_id(text) to authenticated;
grant execute on function public.add_connection_by_email(text) to authenticated;
grant execute on function public.remove_connection(uuid) to authenticated;
grant execute on function public.create_share_invite(uuid) to authenticated;
grant execute on function public.preview_share_invite(text) to authenticated;
grant execute on function public.claim_share_invite(text) to authenticated;

revoke execute on function private.random_code(integer) from public, anon, authenticated;
revoke execute on function private.unique_short_id() from public, anon, authenticated;
revoke execute on function private.are_connected(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.connect_users(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.handle_membership_activated() from public, anon, authenticated;

-- is_connected_with stays executable by API roles: like the Phase 1 helpers, it runs inside the profile select policy with the querying role's privileges.
grant execute on function private.is_connected_with(uuid) to authenticated;
