-- Phase 3 — MVP core loop: the complete RPC surface for the relay plus the scheduled auto-advance job.
-- All state-mutating actions go through these SECURITY DEFINER functions (CLAUDE.md §2.2): clients hold zero write privileges on game tables (Phase 1 revoked them) and only ever read tables and call RPCs.
-- Relay-advance rules — system-random picks, the shared submit-then-pick deadline window, round completion/rollover, and pause/resume when the group cannot sustain a relay — are D029. Invite mechanics (RPC-backed user search, invites by user id) are D030.
-- Error convention (CLAUDE.md §5.7): RPCs raise structured errors — a stable machine code in DETAIL (surfaced as PostgrestError.details) plus a human message in MESSAGE — via private.raise_app_error, never bare throws.
-- Idempotency (CLAUDE.md §2.7): every turn/round transition serializes on a FOR UPDATE lock of the group row and re-checks state after acquiring it, so two clients (or a client racing the cron job) calling in the same millisecond cannot double-advance; partial unique indexes from Phase 1 (one pending turn per round, one in-progress round per group) backstop the locks.

-- ---------------------------------------------------------------------------
-- Error + auth helpers.
-- ---------------------------------------------------------------------------

create function private.raise_app_error(error_code text, error_message text)
returns void
language plpgsql
as $$
begin
  raise exception using message = error_message, detail = error_code, errcode = 'P0001';
end;
$$;

create function private.assert_authenticated()
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    perform private.raise_app_error('not_authenticated', 'You must be signed in.');
  end if;
  return v_uid;
end;
$$;

-- Serialization point for every mutating RPC and the auto-advance job: lock the group row, return it. Re-reads after this lock see the latest committed state, which is what makes the transitions idempotent (CLAUDE.md §2.7).
create function private.lock_group(target_group_id uuid)
returns public."group"
language plpgsql
set search_path = ''
as $$
declare
  v_group public."group";
begin
  select * into v_group from public."group" where id = target_group_id for update;
  if not found then
    perform private.raise_app_error('group_not_found', 'Group not found.');
  end if;
  return v_group;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fairness + pick helpers. Eligibility is always computed by querying membership against turns-this-round (CLAUDE.md §2.6, D014) — never a stored counter.
-- ---------------------------------------------------------------------------

create function private.has_gone_this_round(target_round_id uuid, target_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.turn t
    where t.round_id = target_round_id
      and t.called_out_user_id = target_user_id
  );
$$;

create function private.count_eligible(target_round_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.membership m
  join public.round r on r.id = target_round_id and r.group_id = m.group_id
  where m.status = 'active'
    and not private.has_gone_this_round(target_round_id, m.user_id);
$$;

-- Uniform random pick from the eligible pool (D029). exclude_user_id implements D011's "minus whoever just went" where the just-went player has no turn row this round yet (round starts); within a round the just-went player already has a turn row, which excludes them via the fairness check itself.
create function private.pick_random_eligible(target_round_id uuid, exclude_user_id uuid)
returns uuid
language sql
volatile
set search_path = ''
as $$
  select m.user_id
  from public.membership m
  join public.round r on r.id = target_round_id and r.group_id = m.group_id
  where m.status = 'active'
    and (exclude_user_id is null or m.user_id <> exclude_user_id)
    and not private.has_gone_this_round(target_round_id, m.user_id)
  order by random()
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Turn/round transition helpers. Callers must already hold the group lock.
-- ---------------------------------------------------------------------------

-- Creates the turn with its server-authoritative deadline (CLAUDE.md §2.1) and the called_out notification (D017). caller_user_id is null for system picks (D011/D029).
create function private.create_turn(target_round_id uuid, target_group_id uuid, target_user_id uuid, caller_user_id uuid, turn_deadline interval)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_turn_id uuid;
begin
  -- created_at is stamped with clock_timestamp() (statement-real time), not the column's now() default (transaction time): "latest turn in round" ordering relies on created_at, and rows created inside one transaction would otherwise tie and fall back to comparing random uuids.
  insert into public.turn (round_id, group_id, called_out_user_id, called_by_user_id, deadline_at, created_at)
  values (target_round_id, target_group_id, target_user_id, caller_user_id, now() + turn_deadline, clock_timestamp())
  returning id into v_turn_id;

  insert into public.notification (group_id, turn_id, recipient_user_id, sent_by, type)
  values (target_group_id, v_turn_id, target_user_id, caller_user_id, 'called_out');

  return v_turn_id;
end;
$$;

-- Opens the next round: first-player pick per D029 (D015's no-volunteer fallback applied directly; the volunteer prompt layer is Phase 6), excluding the previous round's final turn-taker when anyone else is eligible (D011's "minus whoever just went"). Pauses the group instead when fewer than two active members remain (D029/D010).
create function private.open_round(locked_group public."group")
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_active_count integer;
  v_prev_last_user uuid;
  v_round_id uuid;
  v_round_number integer;
  v_pick uuid;
  v_turn_id uuid;
begin
  select count(*) into v_active_count
  from public.membership m
  where m.group_id = locked_group.id and m.status = 'active';

  if v_active_count < 2 then
    update public."group" set status = 'paused' where id = locked_group.id;
    return jsonb_build_object('game_paused', true);
  end if;

  select t.called_out_user_id into v_prev_last_user
  from public.turn t
  where t.group_id = locked_group.id
  order by t.created_at desc, t.id desc
  limit 1;

  select coalesce(max(r.round_number), 0) + 1 into v_round_number
  from public.round r
  where r.group_id = locked_group.id;

  insert into public.round (group_id, round_number)
  values (locked_group.id, v_round_number)
  returning id into v_round_id;

  v_pick := private.pick_random_eligible(v_round_id, v_prev_last_user);
  if v_pick is null then
    -- Only possible when the previous round's last player is the sole eligible member; back-to-back is then unavoidable (D029).
    v_pick := private.pick_random_eligible(v_round_id, null);
  end if;

  v_turn_id := private.create_turn(v_round_id, locked_group.id, v_pick, null, locked_group.per_turn_deadline);

  insert into public.notification (group_id, recipient_user_id, type)
  select locked_group.id, m.user_id, 'round_started'
  from public.membership m
  where m.group_id = locked_group.id and m.status = 'active';

  if locked_group.status <> 'active' then
    update public."group" set status = 'active' where id = locked_group.id;
  end if;

  return jsonb_build_object('round_id', v_round_id, 'round_number', v_round_number, 'turn_id', v_turn_id);
end;
$$;

-- Closes a finished round and immediately opens the next one — round cadence is hardcoded to immediate in MVP (plan.md Phase 3); Phase 8 activates recurring cadence against the D026 fields.
create function private.complete_round_and_rollover(target_round_id uuid, locked_group public."group")
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  update public.round set status = 'completed' where id = target_round_id and status = 'in_progress';
  return jsonb_build_object('round_completed', true) || private.open_round(locked_group);
end;
$$;

-- Advances the relay past a resolved turn (missed, skipped, or submitted-but-never-handed-off): system-picks the next player per D029, or completes the round when nobody eligible remains. The resolved turn's holder is excluded from the pick by fairness itself — they already have a turn row this round.
create function private.advance_after(resolved_turn public.turn, locked_group public."group")
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_pick uuid;
  v_turn_id uuid;
begin
  if (select r.status from public.round r where r.id = resolved_turn.round_id) <> 'in_progress' then
    return jsonb_build_object('noop', true);
  end if;

  v_pick := private.pick_random_eligible(resolved_turn.round_id, null);
  if v_pick is null then
    return private.complete_round_and_rollover(resolved_turn.round_id, locked_group);
  end if;

  v_turn_id := private.create_turn(resolved_turn.round_id, locked_group.id, v_pick, null, locked_group.per_turn_deadline);
  return jsonb_build_object('next_turn_id', v_turn_id);
end;
$$;

-- A group that can no longer sustain a relay (fewer than two active members, D010) force-closes its round and pauses (D029). Players never called before the force-close are left untouched (D012). Resume happens automatically in respond_to_invite when the active count recovers.
create function private.force_close_and_pause(locked_group public."group")
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  update public.turn t
  set status = 'skipped'
  where t.status = 'pending'
    and t.round_id in (select r.id from public.round r where r.group_id = locked_group.id and r.status = 'in_progress');

  update public.round set status = 'force_closed' where group_id = locked_group.id and status = 'in_progress';
  update public."group" set status = 'paused' where id = locked_group.id;

  return jsonb_build_object('game_paused', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The scheduled auto-advance job (planning doc §6.4): server-side deadline enforcement, required from the start regardless of push notifications. Two expiry cases per D029: a pending turn past deadline_at is marked missed (casual tone — Phase 7 adds the competitive/elimination branch) and the relay advances; a submitted turn past deadline_at whose hand-off never happened gets a system-picked successor, the turn itself staying submitted because the player did respond.
-- ---------------------------------------------------------------------------

-- Re-evaluates one group under the group lock. Separated from the scan so every advance is individually serialized and idempotent: by the time the lock is acquired the state may already have advanced (a player submitted, another job run won the race), in which case the re-checks make this a no-op.
create function private.advance_group_if_expired(target_group_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_group public."group";
  v_turn public.turn;
begin
  v_group := private.lock_group(target_group_id);

  select t.* into v_turn
  from public.turn t
  join public.round r on r.id = t.round_id
  where r.group_id = target_group_id and r.status = 'in_progress'
  order by t.created_at desc, t.id desc
  limit 1;

  if not found or v_turn.deadline_at > now() then
    return;
  end if;

  if v_turn.status = 'pending' then
    update public.turn set status = 'missed' where id = v_turn.id;
    perform private.advance_after(v_turn, v_group);
  elsif v_turn.status = 'submitted' then
    perform private.advance_after(v_turn, v_group);
  end if;
end;
$$;

create function private.advance_expired_turns()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_rec record;
begin
  for v_rec in
    select r.group_id
    from public.round r
    cross join lateral (
      select t.status, t.deadline_at
      from public.turn t
      where t.round_id = r.id
      order by t.created_at desc, t.id desc
      limit 1
    ) latest
    where r.status = 'in_progress'
      and latest.deadline_at <= now()
      and latest.status in ('pending', 'submitted')
  loop
    perform private.advance_group_if_expired(v_rec.group_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs. SECURITY DEFINER because clients hold no write privileges on game tables (CLAUDE.md §2.2, §6) — each function validates identity, membership, and game rules itself before touching anything.
-- ---------------------------------------------------------------------------

-- Server clock for the client's serverNow() offset (CLAUDE.md §2.1): clients render deadline_at minus this, never a local authoritative timer.
create function public.get_server_time()
returns timestamptz
language sql
stable
as $$
  select now();
$$;

-- D030: minimal-field user search so profile RLS never opens to global reads. Matches display name (substring, case-insensitive) or exact email; minimum query length and a hard result cap keep casual enumeration impractical. SECURITY DEFINER is required to read past profile RLS and to reach auth.users for the email match.
create function public.search_profiles(search_query text)
returns table (user_id uuid, display_name text, avatar_url text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_query text;
begin
  v_uid := private.assert_authenticated();
  v_query := btrim(coalesce(search_query, ''));

  if char_length(v_query) < 2 then
    perform private.raise_app_error('query_too_short', 'Type at least 2 characters to search.');
  end if;

  return query
  select p.id, p.display_name, p.avatar_url
  from public.profile p
  left join auth.users u on u.id = p.id
  where p.id <> v_uid
    and (
      p.display_name ilike '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or lower(u.email) = lower(v_query)
    )
  order by p.display_name asc
  limit 10;
end;
$$;

-- Creates a group with MVP-hardcoded settings (plan.md Phase 3): text-only, casual, manual targeting, immediate cadence — only name, per-turn deadline, and invitees are caller-supplied. Later phases expose the other Phase 1 fields; they are not stripped (CLAUDE.md §4.3).
create function public.create_group(group_name text, deadline_minutes integer, invitee_ids uuid[] default array[]::uuid[])
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

-- Invite (or mid-game add — the same action: the invitee still accepts) a player. Host-only in Phase 3; Phase 5 extends this permission to admins (D013).
create function public.invite_player(target_group_id uuid, target_user_id uuid)
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

-- Accept or decline a pending invite (user story 8). Declining deletes the membership row so a later re-invite is possible; the inviter is not notified (per the prototype's decline copy). Accepting can auto-resume a paused game (D029).
create function public.respond_to_invite(target_group_id uuid, accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group public."group";
  v_membership public.membership;
  v_result jsonb;
begin
  v_uid := private.assert_authenticated();
  v_group := private.lock_group(target_group_id);

  select * into v_membership from public.membership m
  where m.group_id = v_group.id and m.user_id = v_uid;

  if not found or v_membership.status <> 'invited' then
    perform private.raise_app_error('not_invited', 'You do not have a pending invite to this group.');
  end if;

  if not accept then
    delete from public.membership where id = v_membership.id;
    return jsonb_build_object('status', 'declined');
  end if;

  update public.membership set status = 'active', joined_at = now() where id = v_membership.id;

  insert into public.notification (group_id, recipient_user_id, sent_by, type)
  select v_group.id, m.user_id, v_uid, 'member_joined'
  from public.membership m
  where m.group_id = v_group.id and m.status = 'active' and m.user_id <> v_uid;

  v_result := jsonb_build_object('status', 'joined');
  if v_group.status = 'paused' then
    -- open_round re-checks the active count and either resumes with a fresh round or stays paused (D029).
    v_result := v_result || private.open_round(v_group);
  end if;

  return v_result;
end;
$$;

-- Host starts the game once at least two members are active (D010): the group goes active and round 1 opens with a system-picked first player (D029).
create function public.start_game(target_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group public."group";
  v_active_count integer;
begin
  v_uid := private.assert_authenticated();
  v_group := private.lock_group(target_group_id);

  if v_group.host_id <> v_uid then
    perform private.raise_app_error('not_host', 'Only the host can start the game.');
  end if;
  if v_group.status <> 'setup' then
    perform private.raise_app_error('game_already_started', 'This game has already started.');
  end if;

  select count(*) into v_active_count
  from public.membership m
  where m.group_id = v_group.id and m.status = 'active';

  if v_active_count < 2 then
    perform private.raise_app_error('too_few_members', 'At least 2 joined members are needed to start.');
  end if;

  return private.open_round(v_group);
end;
$$;

-- Submit the text response for a pending turn (user story 13). Strictly deadline-checked (D029): a late submission is rejected even if the auto-advance job has not marked the miss yet, so casual and competitive tones share one deadline semantic. Completes the round immediately when the submitter was the last eligible player; otherwise the hand-off (call_out_player) is the caller's next move.
create function public.submit_turn(target_turn_id uuid, submission_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_turn public.turn;
  v_group public."group";
  v_round public.round;
  v_submission_id uuid;
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

  update public.turn set status = 'submitted' where id = v_turn.id;

  if private.count_eligible(v_round.id) = 0 then
    return jsonb_build_object('submission_id', v_submission_id, 'handoff_required', false)
      || private.complete_round_and_rollover(v_round.id, v_group);
  end if;

  return jsonb_build_object('submission_id', v_submission_id, 'handoff_required', true);
end;
$$;

-- Manual-targeting hand-off (user story 14): the player who just submitted picks who is next. Fairness is a hard constraint (CLAUDE.md §2.6, D014): the target must be an active member with no turn this round, no override. Shares the turn's deadline window per D029 — past deadline_at the system pick takes over.
create function public.call_out_player(target_turn_id uuid, target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_turn public.turn;
  v_group public."group";
  v_round public.round;
  v_new_turn_id uuid;
begin
  v_uid := private.assert_authenticated();

  select * into v_turn from public.turn t where t.id = target_turn_id;
  if not found then
    perform private.raise_app_error('turn_not_found', 'Turn not found.');
  end if;

  v_group := private.lock_group(v_turn.group_id);
  select * into v_turn from public.turn t where t.id = target_turn_id;
  select * into v_round from public.round r where r.id = v_turn.round_id;

  if v_turn.called_out_user_id <> v_uid then
    perform private.raise_app_error('not_your_turn', 'This is not your turn.');
  end if;
  if not exists (select 1 from public.membership m where m.group_id = v_group.id and m.user_id = v_uid and m.status = 'active') then
    perform private.raise_app_error('not_a_member', 'You are not an active member of this group.');
  end if;
  if v_round.status <> 'in_progress' then
    perform private.raise_app_error('round_closed', 'This round is over.');
  end if;
  if v_turn.status = 'pending' then
    perform private.raise_app_error('submit_first', 'Submit your response before picking who is next.');
  end if;
  if v_turn.status <> 'submitted' then
    perform private.raise_app_error('turn_not_pending', 'This turn has already been resolved.');
  end if;
  if exists (
    select 1 from public.turn t2
    where t2.round_id = v_round.id and (t2.created_at, t2.id) > (v_turn.created_at, v_turn.id)
  ) then
    perform private.raise_app_error('handoff_already_made', 'The next player has already been picked.');
  end if;
  if now() > v_turn.deadline_at then
    perform private.raise_app_error('deadline_passed', 'The hand-off window has passed; the system is picking the next player.');
  end if;
  if target_user_id = v_uid then
    perform private.raise_app_error('target_not_eligible', 'You cannot call yourself.');
  end if;
  if not exists (select 1 from public.membership m where m.group_id = v_group.id and m.user_id = target_user_id and m.status = 'active') then
    perform private.raise_app_error('target_not_eligible', 'That player is not an active member.');
  end if;
  if private.has_gone_this_round(v_round.id, target_user_id) then
    perform private.raise_app_error('target_not_eligible', 'That player has already gone this round.');
  end if;

  v_new_turn_id := private.create_turn(v_round.id, v_group.id, target_user_id, v_uid, v_group.per_turn_deadline);
  return jsonb_build_object('turn_id', v_new_turn_id);
end;
$$;

-- Host-only mid-round control (user story 25 scoped to MVP's host-only phase): skip a pending turn; the relay advances exactly as after a miss (D029).
create function public.skip_turn(target_turn_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_turn public.turn;
  v_group public."group";
  v_round public.round;
begin
  v_uid := private.assert_authenticated();

  select * into v_turn from public.turn t where t.id = target_turn_id;
  if not found then
    perform private.raise_app_error('turn_not_found', 'Turn not found.');
  end if;

  v_group := private.lock_group(v_turn.group_id);
  select * into v_turn from public.turn t where t.id = target_turn_id;
  select * into v_round from public.round r where r.id = v_turn.round_id;

  if v_group.host_id <> v_uid then
    perform private.raise_app_error('not_host', 'Only the host can skip a turn.');
  end if;
  if v_round.status <> 'in_progress' then
    perform private.raise_app_error('round_closed', 'This round is over.');
  end if;
  if v_turn.status <> 'pending' then
    perform private.raise_app_error('turn_not_pending', 'Only a pending turn can be skipped.');
  end if;

  update public.turn set status = 'skipped' where id = v_turn.id;

  return jsonb_build_object('skipped_turn_id', v_turn.id) || private.advance_after(v_turn, v_group);
end;
$$;

-- Host-only removal (MVP scope; admin removal is Phase 5, moderation-driven removal is Phase 9). Rescinds pending invites outright; otherwise marks the membership removed — the member can no longer read (Phase 1 RLS) or act. Keeps the relay consistent per D029: a removed player's pending turn is skipped and advanced past, and a group left under two active members force-closes its round and pauses.
create function public.remove_player(target_group_id uuid, target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group public."group";
  v_membership public.membership;
  v_round public.round;
  v_latest_turn public.turn;
  v_active_count integer;
  v_result jsonb;
begin
  v_uid := private.assert_authenticated();
  v_group := private.lock_group(target_group_id);

  if v_group.host_id <> v_uid then
    perform private.raise_app_error('not_host', 'Only the host can remove players.');
  end if;
  if target_user_id = v_uid then
    perform private.raise_app_error('cannot_remove_self', 'The host cannot remove themselves; host transfer arrives in a later phase.');
  end if;

  select * into v_membership from public.membership m
  where m.group_id = v_group.id and m.user_id = target_user_id;

  if not found or v_membership.status = 'removed' then
    perform private.raise_app_error('not_a_member', 'That user is not a member of this group.');
  end if;

  if v_membership.status = 'invited' then
    delete from public.membership where id = v_membership.id;
    return jsonb_build_object('status', 'invite_rescinded');
  end if;

  update public.membership set status = 'removed' where id = v_membership.id;
  v_result := jsonb_build_object('status', 'removed');

  if v_group.status <> 'active' then
    return v_result;
  end if;

  select * into v_round from public.round r where r.group_id = v_group.id and r.status = 'in_progress';
  if not found then
    return v_result;
  end if;

  select count(*) into v_active_count
  from public.membership m
  where m.group_id = v_group.id and m.status = 'active';

  if v_active_count < 2 then
    return v_result || private.force_close_and_pause(v_group);
  end if;

  select t.* into v_latest_turn
  from public.turn t
  where t.round_id = v_round.id
  order by t.created_at desc, t.id desc
  limit 1;

  if v_latest_turn.status = 'pending' and v_latest_turn.called_out_user_id = target_user_id then
    -- The removed player held the live turn: resolve it as skipped and advance past them.
    update public.turn set status = 'skipped' where id = v_latest_turn.id;
    v_result := v_result || private.advance_after(v_latest_turn, v_group);
  elsif v_latest_turn.status = 'submitted' and private.count_eligible(v_round.id) = 0 then
    -- The removal emptied the eligible pool while a hand-off was pending: the round is complete.
    v_result := v_result || private.complete_round_and_rollover(v_round.id, v_group);
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. Function creation grants EXECUTE to PUBLIC by default; the RPC surface is authenticated-only and the private helpers are reachable only through the definer RPCs and the cron job.
-- ---------------------------------------------------------------------------

revoke execute on function public.get_server_time() from public, anon;
revoke execute on function public.search_profiles(text) from public, anon;
revoke execute on function public.create_group(text, integer, uuid[]) from public, anon;
revoke execute on function public.invite_player(uuid, uuid) from public, anon;
revoke execute on function public.respond_to_invite(uuid, boolean) from public, anon;
revoke execute on function public.start_game(uuid) from public, anon;
revoke execute on function public.submit_turn(uuid, text) from public, anon;
revoke execute on function public.call_out_player(uuid, uuid) from public, anon;
revoke execute on function public.skip_turn(uuid) from public, anon;
revoke execute on function public.remove_player(uuid, uuid) from public, anon;

grant execute on function public.get_server_time() to authenticated;
grant execute on function public.search_profiles(text) to authenticated;
grant execute on function public.create_group(text, integer, uuid[]) to authenticated;
grant execute on function public.invite_player(uuid, uuid) to authenticated;
grant execute on function public.respond_to_invite(uuid, boolean) to authenticated;
grant execute on function public.start_game(uuid) to authenticated;
grant execute on function public.submit_turn(uuid, text) to authenticated;
grant execute on function public.call_out_player(uuid, uuid) to authenticated;
grant execute on function public.skip_turn(uuid) to authenticated;
grant execute on function public.remove_player(uuid, uuid) to authenticated;

revoke execute on function private.raise_app_error(text, text) from public, anon, authenticated;
revoke execute on function private.assert_authenticated() from public, anon, authenticated;
revoke execute on function private.lock_group(uuid) from public, anon, authenticated;
revoke execute on function private.has_gone_this_round(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.count_eligible(uuid) from public, anon, authenticated;
revoke execute on function private.pick_random_eligible(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.create_turn(uuid, uuid, uuid, uuid, interval) from public, anon, authenticated;
revoke execute on function private.open_round(public."group") from public, anon, authenticated;
revoke execute on function private.complete_round_and_rollover(uuid, public."group") from public, anon, authenticated;
revoke execute on function private.advance_after(public.turn, public."group") from public, anon, authenticated;
revoke execute on function private.force_close_and_pause(public."group") from public, anon, authenticated;
revoke execute on function private.advance_group_if_expired(uuid) from public, anon, authenticated;
revoke execute on function private.advance_expired_turns() from public, anon, authenticated;

-- SECURITY DEFINER functions run as their owner; the RPCs above call these helpers, so the definer (the migration role) retains execute via ownership. The functions the RPCs call directly need no client grants.

-- ---------------------------------------------------------------------------
-- Schedule the auto-advance job (planning doc §6.4). One-minute granularity is well inside the 5-minute minimum per-turn deadline. The unschedule guard keeps the migration re-runnable against a database where the job already exists (CLAUDE.md §5.9).
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('callout-advance-expired-turns');
exception
  when others then null;
end;
$$;

select cron.schedule('callout-advance-expired-turns', '* * * * *', $$select private.advance_expired_turns()$$);
