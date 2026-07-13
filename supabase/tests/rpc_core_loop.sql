-- Phase 3 — pgTAP verification of the MVP core-loop RPCs (run with `supabase test db`).
-- Drives the full relay through the public RPC surface exactly as PostgREST executes it (SET ROLE + request.jwt.claims per persona): group creation, invites, start, submit/hand-off with fairness, strict deadlines, the auto-advance job's miss and hand-off-timeout paths with idempotency, round completion/rollover with the back-to-back exclusion, and remove/pause/resume. References: decisions.md D029, D030, D014, D010.
-- Where the system picks randomly (D029), assertions check properties of the pick (eligibility, exclusions) rather than identities, except where exclusions make the pick fully deterministic.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(89);

-- ---------------------------------------------------------------------------
-- Fixtures and impersonation plumbing. ctx carries ids across role switches (RPC-created rows have generated ids, unlike Phase 1's fixed-uuid fixtures).
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@callout.test', '{"display_name": "Alice"}'::jsonb),
  ('00000000-0000-0000-0000-00000000000b', 'bob@callout.test', '{"display_name": "Bob"}'::jsonb),
  ('00000000-0000-0000-0000-00000000000c', 'cara@callout.test', '{"display_name": "Cara"}'::jsonb),
  ('00000000-0000-0000-0000-00000000000d', 'dave@callout.test', '{"display_name": "Dave"}'::jsonb),
  ('00000000-0000-0000-0000-00000000000e', 'evan@callout.test', '{"display_name": "Evan"}'::jsonb);

create temp table ctx (key text primary key, val text);
grant all on ctx to public;

create function pg_temp.impersonate(target_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', target_user, 'role', 'authenticated')::text, true);
end;
$$;

create function pg_temp.ctx_set(target_key text, target_val text) returns void language plpgsql as $$
begin
  insert into ctx (key, val) values (target_key, target_val)
  on conflict (key) do update set val = excluded.val;
end;
$$;

create function pg_temp.ctx_uuid(target_key text) returns uuid language sql as $$
  select val::uuid from ctx where key = target_key;
$$;

create function pg_temp.ctx_jsonb(target_key text) returns jsonb language sql as $$
  select val::jsonb from ctx where key = target_key;
$$;

-- ---------------------------------------------------------------------------
-- search_profiles (D030): minimum query length, name substring match, exact email match, self-exclusion.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000a');

select throws_ok($$ select * from public.search_profiles('b') $$, 'P0001', 'Type at least 2 characters to search.', 'search rejects queries under 2 characters');
select is((select count(*)::int from public.search_profiles('bo')), 1, 'name substring search finds exactly Bob');
select is((select s.display_name from public.search_profiles('cara@callout.test') s), 'Cara', 'exact email search finds Cara');
select is((select count(*)::int from public.search_profiles('ali')), 0, 'search never returns the caller themselves');

-- ---------------------------------------------------------------------------
-- create_group: validation, MVP-hardcoded settings, host + invited memberships, invite notifications.
-- ---------------------------------------------------------------------------

select throws_ok($$ select public.create_group('', 60, array[]::uuid[]) $$, 'P0001', 'Group name must be between 1 and 80 characters.', 'create_group rejects an empty name');
select throws_ok($$ select public.create_group('Relay Crew', 3, array[]::uuid[]) $$, 'P0001', 'Response deadline must be between 5 minutes and 7 days.', 'create_group rejects an out-of-range deadline');
select throws_ok($$ select public.create_group('Relay Crew', 60, array['99999999-9999-9999-9999-999999999999']::uuid[]) $$, 'P0001', 'One of the invited users does not exist.', 'create_group rejects unknown invitees');

select pg_temp.ctx_set('group1', (public.create_group('Relay Crew', 60, array['00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c']::uuid[]) ->> 'group_id'));

reset role;

select is((select g.status from public."group" g where g.id = pg_temp.ctx_uuid('group1')), 'setup'::public.group_status, 'new group starts in setup');
select ok((select g.tone = 'casual' and g.targeting_mode = 'manual' and g.round_cadence = 'immediate' and g.accepted_submission_types = array['text']::public.submission_type[] from public."group" g where g.id = pg_temp.ctx_uuid('group1')), 'new group gets the MVP-hardcoded settings: casual, manual, immediate, text-only');
select is((select g.per_turn_deadline from public."group" g where g.id = pg_temp.ctx_uuid('group1')), interval '1 hour', 'per-turn deadline stored from the minutes parameter');
select ok((select m.role = 'host' and m.status = 'active' and m.joined_at is not null from public.membership m where m.group_id = pg_temp.ctx_uuid('group1') and m.user_id = '00000000-0000-0000-0000-00000000000a'), 'creator becomes the active host');
select is((select count(*)::int from public.membership m where m.group_id = pg_temp.ctx_uuid('group1') and m.role = 'player' and m.status = 'invited'), 2, 'both invitees hold invited memberships');
select is((select count(*)::int from public.notification n where n.group_id = pg_temp.ctx_uuid('group1') and n.type = 'group_invited'), 2, 'both invitees got a group_invited notification');

-- ---------------------------------------------------------------------------
-- The RPC surface is authenticated-only.
-- ---------------------------------------------------------------------------

set local role anon;
select throws_ok($$ select public.create_group('x', 60, array[]::uuid[]) $$, '42501', null, 'anon cannot execute create_group');
select throws_ok($$ select public.get_server_time() $$, '42501', null, 'anon cannot execute get_server_time');
reset role;

-- ---------------------------------------------------------------------------
-- Invite responses and start_game gating (D010 minimum of two).
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000d');
select throws_ok(format($f$ select public.respond_to_invite('%s', true) $f$, pg_temp.ctx_uuid('group1')), 'P0001', 'You do not have a pending invite to this group.', 'a non-invited user cannot accept');

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000a');
select throws_ok(format($f$ select public.start_game('%s') $f$, pg_temp.ctx_uuid('group1')), 'P0001', 'At least 2 joined members are needed to start.', 'start_game requires two active members');

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000b');
select is((public.respond_to_invite(pg_temp.ctx_uuid('group1'), true) ->> 'status'), 'joined', 'Bob accepts his invite');

reset role;
select ok((select m.status = 'active' and m.joined_at is not null from public.membership m where m.group_id = pg_temp.ctx_uuid('group1') and m.user_id = '00000000-0000-0000-0000-00000000000b'), 'accepting flips the membership to active with joined_at set');
select is((select count(*)::int from public.notification n where n.group_id = pg_temp.ctx_uuid('group1') and n.type = 'member_joined' and n.recipient_user_id = '00000000-0000-0000-0000-00000000000a'), 1, 'the host was notified of the join');

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000c');
select is((public.respond_to_invite(pg_temp.ctx_uuid('group1'), false) ->> 'status'), 'declined', 'Cara declines her invite');

reset role;
select is((select count(*)::int from public.membership m where m.group_id = pg_temp.ctx_uuid('group1')), 2, 'declining deletes the membership row so a re-invite stays possible');

-- ---------------------------------------------------------------------------
-- start_game: host-only; opens round 1 with a system-picked first turn (D029).
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000b');
select throws_ok(format($f$ select public.start_game('%s') $f$, pg_temp.ctx_uuid('group1')), 'P0001', 'Only the host can start the game.', 'a non-host cannot start the game');

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000a');
select pg_temp.ctx_set('start_res', public.start_game(pg_temp.ctx_uuid('group1'))::text);

reset role;
select ok((pg_temp.ctx_jsonb('start_res') ? 'round_id') and (pg_temp.ctx_jsonb('start_res') ? 'turn_id'), 'start_game returns the opened round and first turn');
select is((select g.status from public."group" g where g.id = pg_temp.ctx_uuid('group1')), 'active'::public.group_status, 'the group is active after start');
select ok((select r.round_number = 1 and r.status = 'in_progress' from public.round r where r.id = (pg_temp.ctx_jsonb('start_res') ->> 'round_id')::uuid), 'round 1 is in progress');

select pg_temp.ctx_set('round1', pg_temp.ctx_jsonb('start_res') ->> 'round_id');
select pg_temp.ctx_set('turn1', pg_temp.ctx_jsonb('start_res') ->> 'turn_id');
select pg_temp.ctx_set('holder1', (select t.called_out_user_id::text from public.turn t where t.id = pg_temp.ctx_uuid('turn1')));
select pg_temp.ctx_set('other1', (select case when pg_temp.ctx_uuid('holder1') = '00000000-0000-0000-0000-00000000000a' then '00000000-0000-0000-0000-00000000000b' else '00000000-0000-0000-0000-00000000000a' end)::text);

select ok((select t.status = 'pending' and t.called_by_user_id is null and t.called_out_user_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b') from public.turn t where t.id = pg_temp.ctx_uuid('turn1')), 'the first turn is a pending system pick of an active member');
select ok((select t.deadline_at between now() + interval '59 minutes' and now() + interval '61 minutes' from public.turn t where t.id = pg_temp.ctx_uuid('turn1')), 'the first turn deadline is server-set from the group setting');
select is((select count(*)::int from public.notification n where n.group_id = pg_temp.ctx_uuid('group1') and n.type = 'round_started'), 2, 'every active member got a round_started notification');
select is((select count(*)::int from public.notification n where n.type = 'called_out' and n.recipient_user_id = pg_temp.ctx_uuid('holder1')), 1, 'the picked player got a called_out notification');

-- ---------------------------------------------------------------------------
-- submit_turn: only the holder, only with valid text, only in time (D029 strict deadline).
-- ---------------------------------------------------------------------------

select pg_temp.impersonate(pg_temp.ctx_uuid('other1'));
select throws_ok(format($f$ select public.submit_turn('%s', 'not mine') $f$, pg_temp.ctx_uuid('turn1')), 'P0001', 'This is not your turn.', 'a non-holder cannot submit');

select pg_temp.impersonate(pg_temp.ctx_uuid('holder1'));
select throws_ok(format($f$ select public.call_out_player('%s', '%s') $f$, pg_temp.ctx_uuid('turn1'), pg_temp.ctx_uuid('other1')), 'P0001', 'Submit your response before picking who is next.', 'hand-off is blocked until the response is submitted');
select throws_ok(format($f$ select public.submit_turn('%s', '   ') $f$, pg_temp.ctx_uuid('turn1')), 'P0001', 'Submission text is required.', 'blank submissions are rejected');
select throws_ok(format($f$ select public.submit_turn('%s', repeat('x', 2001)) $f$, pg_temp.ctx_uuid('turn1')), 'P0001', 'Submissions are limited to 2,000 characters.', 'over-length submissions are rejected');

select pg_temp.ctx_set('submit1_res', public.submit_turn(pg_temp.ctx_uuid('turn1'), 'First check-in done')::text);
select ok((pg_temp.ctx_jsonb('submit1_res') ->> 'handoff_required')::boolean, 'submitting with eligible players left requires a manual hand-off');

reset role;
select ok((select t.status = 'submitted' from public.turn t where t.id = pg_temp.ctx_uuid('turn1')) and exists (select 1 from public.submission s where s.turn_id = pg_temp.ctx_uuid('turn1') and s.type = 'text' and s.text_content = 'First check-in done'), 'the submission row exists and the turn is submitted');

-- ---------------------------------------------------------------------------
-- call_out_player: fairness is a hard constraint (D014), no self-calls, active members only.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate(pg_temp.ctx_uuid('holder1'));
select throws_ok(format($f$ select public.call_out_player('%s', '%s') $f$, pg_temp.ctx_uuid('turn1'), pg_temp.ctx_uuid('holder1')), 'P0001', 'You cannot call yourself.', 'a player cannot call themselves');
select throws_ok(format($f$ select public.call_out_player('%s', '00000000-0000-0000-0000-00000000000c') $f$, pg_temp.ctx_uuid('turn1')), 'P0001', 'That player is not an active member.', 'a non-member cannot be called');

select pg_temp.ctx_set('turn2', (public.call_out_player(pg_temp.ctx_uuid('turn1'), pg_temp.ctx_uuid('other1')) ->> 'turn_id'));
select throws_ok(format($f$ select public.call_out_player('%s', '%s') $f$, pg_temp.ctx_uuid('turn1'), pg_temp.ctx_uuid('other1')), 'P0001', 'The next player has already been picked.', 'a hand-off cannot be made twice');

reset role;
select ok((select t.status = 'pending' and t.called_by_user_id = pg_temp.ctx_uuid('holder1') and t.called_out_user_id = pg_temp.ctx_uuid('other1') from public.turn t where t.id = pg_temp.ctx_uuid('turn2')), 'the manual hand-off created a pending turn attributed to the caller');

-- ---------------------------------------------------------------------------
-- Round completion + immediate rollover (D029): the last eligible submit closes the round and opens the next, excluding the just-went player from the opening pick.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate(pg_temp.ctx_uuid('other1'));
select pg_temp.ctx_set('submit2_res', public.submit_turn(pg_temp.ctx_uuid('turn2'), 'Second check-in')::text);
select ok((pg_temp.ctx_jsonb('submit2_res') ->> 'handoff_required')::boolean = false and (pg_temp.ctx_jsonb('submit2_res') ->> 'round_completed')::boolean, 'the last eligible submit completes the round with no hand-off');

reset role;
select is((select r.status from public.round r where r.id = pg_temp.ctx_uuid('round1')), 'completed'::public.round_status, 'round 1 is completed');
select ok((select r.round_number = 2 and r.status = 'in_progress' from public.round r where r.id = (pg_temp.ctx_jsonb('submit2_res') ->> 'round_id')::uuid), 'round 2 opened immediately');

select pg_temp.ctx_set('round2', pg_temp.ctx_jsonb('submit2_res') ->> 'round_id');
select pg_temp.ctx_set('turn3', pg_temp.ctx_jsonb('submit2_res') ->> 'turn_id');

select is((select t.called_out_user_id from public.turn t where t.id = pg_temp.ctx_uuid('turn3')), pg_temp.ctx_uuid('holder1'), 'round 2 opens with the player who did NOT close round 1 — no back-to-back across the boundary (D029)');
select ok((select t.called_by_user_id is null and t.status = 'pending' from public.turn t where t.id = pg_temp.ctx_uuid('turn3')), 'the round-opening turn is a system pick');

-- ---------------------------------------------------------------------------
-- Mid-game invites (host-only in Phase 3) and the fairness error with three players.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000b');
select throws_ok(format($f$ select public.invite_player('%s', '00000000-0000-0000-0000-00000000000e') $f$, pg_temp.ctx_uuid('group1')), 'P0001', 'Only the host can invite players.', 'a non-host cannot invite');

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000a');
select lives_ok(format($f$ select public.invite_player('%s', '00000000-0000-0000-0000-00000000000e') $f$, pg_temp.ctx_uuid('group1')), 'the host invites Evan mid-game');
select throws_ok(format($f$ select public.invite_player('%s', '00000000-0000-0000-0000-00000000000e') $f$, pg_temp.ctx_uuid('group1')), 'P0001', 'That user already has a pending invite.', 'double-inviting is rejected');
select throws_ok(format($f$ select public.invite_player('%s', '00000000-0000-0000-0000-00000000000b') $f$, pg_temp.ctx_uuid('group1')), 'P0001', 'That user is already a member.', 'inviting an existing member is rejected');

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000e');
select is((public.respond_to_invite(pg_temp.ctx_uuid('group1'), true) ->> 'status'), 'joined', 'Evan joins mid-game');

reset role;
select is((select count(*)::int from public.notification n where n.group_id = pg_temp.ctx_uuid('group1') and n.type = 'member_joined' and n.sent_by = '00000000-0000-0000-0000-00000000000e'), 2, 'both existing active members were notified of the mid-game join');

-- Round 2 relay with three players: holder1 -> Evan -> other1, proving the has-gone fairness rejection along the way.
select pg_temp.impersonate(pg_temp.ctx_uuid('holder1'));
select ok((public.submit_turn(pg_temp.ctx_uuid('turn3'), 'Round two, first up') ->> 'handoff_required')::boolean, 'round 2 opener submits and must hand off');
select pg_temp.ctx_set('turn4', (public.call_out_player(pg_temp.ctx_uuid('turn3'), '00000000-0000-0000-0000-00000000000e') ->> 'turn_id'));

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000e');
select ok((public.submit_turn(pg_temp.ctx_uuid('turn4'), 'New guy checking in') ->> 'handoff_required')::boolean, 'a mid-game joiner is immediately eligible and can take a turn (D014 pool)');
select throws_ok(format($f$ select public.call_out_player('%s', '%s') $f$, pg_temp.ctx_uuid('turn4'), pg_temp.ctx_uuid('holder1')), 'P0001', 'That player has already gone this round.', 'fairness rejects calling a player who already went this round (D014)');
select pg_temp.ctx_set('turn5', (public.call_out_player(pg_temp.ctx_uuid('turn4'), pg_temp.ctx_uuid('other1')) ->> 'turn_id'));

select pg_temp.impersonate(pg_temp.ctx_uuid('other1'));
select pg_temp.ctx_set('submit5_res', public.submit_turn(pg_temp.ctx_uuid('turn5'), 'Closing round two')::text);
select ok((pg_temp.ctx_jsonb('submit5_res') ->> 'round_completed')::boolean and (pg_temp.ctx_jsonb('submit5_res') ? 'turn_id'), 'round 2 completed and round 3 opened');

reset role;
select pg_temp.ctx_set('round3', pg_temp.ctx_jsonb('submit5_res') ->> 'round_id');
select pg_temp.ctx_set('turn6', pg_temp.ctx_jsonb('submit5_res') ->> 'turn_id');
select pg_temp.ctx_set('holder6', (select t.called_out_user_id::text from public.turn t where t.id = pg_temp.ctx_uuid('turn6')));
select ok((select t.called_out_user_id <> pg_temp.ctx_uuid('other1') from public.turn t where t.id = pg_temp.ctx_uuid('turn6')), 'round 3 opener excludes whoever closed round 2');

-- ---------------------------------------------------------------------------
-- skip_turn: host-only; advances exactly like a miss (D029).
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000e');
select throws_ok(format($f$ select public.skip_turn('%s') $f$, pg_temp.ctx_uuid('turn6')), 'P0001', 'Only the host can skip a turn.', 'a non-host cannot skip');

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000a');
select pg_temp.ctx_set('skip_res', public.skip_turn(pg_temp.ctx_uuid('turn6'))::text);

reset role;
select is((select t.status from public.turn t where t.id = pg_temp.ctx_uuid('turn6')), 'skipped'::public.turn_status, 'the skipped turn is marked skipped');
select pg_temp.ctx_set('turn7', pg_temp.ctx_jsonb('skip_res') ->> 'next_turn_id');
select pg_temp.ctx_set('holder7', (select t.called_out_user_id::text from public.turn t where t.id = pg_temp.ctx_uuid('turn7')));
select ok((select t.status = 'pending' and t.called_by_user_id is null and t.called_out_user_id <> pg_temp.ctx_uuid('holder6') from public.turn t where t.id = pg_temp.ctx_uuid('turn7')), 'skipping advanced to a system-picked eligible player');

-- ---------------------------------------------------------------------------
-- Deadline expiry: strict rejection first (D029), then the job marks the miss and advances; the job is idempotent (CLAUDE.md §2.7).
-- ---------------------------------------------------------------------------

update public.turn set deadline_at = now() - interval '2 minutes' where id = pg_temp.ctx_uuid('turn7');

select pg_temp.impersonate(pg_temp.ctx_uuid('holder7'));
select throws_ok(format($f$ select public.submit_turn('%s', 'too late') $f$, pg_temp.ctx_uuid('turn7')), 'P0001', 'The deadline for this turn has passed.', 'a late submission is rejected even before the job has run (D029 strict deadline)');

reset role;
select private.advance_expired_turns();

select is((select t.status from public.turn t where t.id = pg_temp.ctx_uuid('turn7')), 'missed'::public.turn_status, 'the expired pending turn was marked missed');
select pg_temp.ctx_set('holder8', (select t.called_out_user_id::text from public.turn t where t.round_id = pg_temp.ctx_uuid('round3') and t.status = 'pending'));
select pg_temp.ctx_set('turn8', (select t.id::text from public.turn t where t.round_id = pg_temp.ctx_uuid('round3') and t.status = 'pending'));
select ok(pg_temp.ctx_uuid('holder8') is not null and pg_temp.ctx_uuid('holder8') not in (pg_temp.ctx_uuid('holder6'), pg_temp.ctx_uuid('holder7')), 'the miss auto-advanced to the one member who had not gone this round');

select private.advance_expired_turns();
select is((select count(*)::int from public.turn t where t.round_id = pg_temp.ctx_uuid('round3')), 3, 'running the job again changes nothing — auto-advance is idempotent');

-- ---------------------------------------------------------------------------
-- Hand-off timeout (D029): the submit landed but the pick never happened; past the deadline the system picks, the turn stays submitted.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate(pg_temp.ctx_uuid('holder8'));
select pg_temp.ctx_set('submit8_res', public.submit_turn(pg_temp.ctx_uuid('turn8'), 'Everyone went this round')::text);
select ok((pg_temp.ctx_jsonb('submit8_res') ->> 'round_completed')::boolean, 'the final member submitting closes round 3 (skips and misses count as gone)');

reset role;
select pg_temp.ctx_set('round4', pg_temp.ctx_jsonb('submit8_res') ->> 'round_id');
select pg_temp.ctx_set('turn9', pg_temp.ctx_jsonb('submit8_res') ->> 'turn_id');
select pg_temp.ctx_set('holder9', (select t.called_out_user_id::text from public.turn t where t.id = pg_temp.ctx_uuid('turn9')));
select ok((select t.called_out_user_id <> pg_temp.ctx_uuid('holder8') from public.turn t where t.id = pg_temp.ctx_uuid('turn9')), 'round 4 opener excludes whoever closed round 3');

select pg_temp.impersonate(pg_temp.ctx_uuid('holder9'));
select ok((public.submit_turn(pg_temp.ctx_uuid('turn9'), 'Round four!') ->> 'handoff_required')::boolean, 'round 4 opener submits in time');

reset role;
update public.turn set deadline_at = now() - interval '2 minutes' where id = pg_temp.ctx_uuid('turn9');

select pg_temp.impersonate(pg_temp.ctx_uuid('holder9'));
select throws_ok(format($f$ select public.call_out_player('%s', '00000000-0000-0000-0000-00000000000d') $f$, pg_temp.ctx_uuid('turn9')), 'P0001', 'The hand-off window has passed; the system is picking the next player.', 'a late hand-off is rejected (D029: submit and pick share the deadline window)');

reset role;
select private.advance_expired_turns();

select is((select t.status from public.turn t where t.id = pg_temp.ctx_uuid('turn9')), 'submitted'::public.turn_status, 'the submitted turn stays submitted after the hand-off timeout — the player did respond');
select ok(exists (select 1 from public.turn t where t.round_id = pg_temp.ctx_uuid('round4') and t.status = 'pending' and t.called_by_user_id is null and t.called_out_user_id <> pg_temp.ctx_uuid('holder9')), 'the job system-picked a successor for the stalled hand-off');

-- ---------------------------------------------------------------------------
-- remove_player on controlled fixtures (D029 pause/resume): direct seeding keeps the holders deterministic.
-- ---------------------------------------------------------------------------

insert into public."group" (id, name, host_id, per_turn_deadline, status) values
  ('88888888-8888-8888-8888-888888888888', 'Removal Test', '00000000-0000-0000-0000-00000000000a', interval '1 hour', 'active');
insert into public.membership (group_id, user_id, role, status, joined_at) values
  ('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-00000000000a', 'host', 'active', now()),
  ('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-00000000000b', 'player', 'active', now()),
  ('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-00000000000e', 'player', 'active', now());
insert into public.round (id, group_id, round_number, status) values
  ('88888888-8888-8888-8888-888888888801', '88888888-8888-8888-8888-888888888888', 1, 'in_progress');
insert into public.turn (id, round_id, group_id, called_out_user_id, deadline_at, status) values
  ('88888888-8888-8888-8888-888888888802', '88888888-8888-8888-8888-888888888801', '88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-00000000000b', now() + interval '1 hour', 'pending');

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select public.remove_player('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-00000000000e') $$, 'P0001', 'Only the host can remove players.', 'a non-host cannot remove players');

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ select public.remove_player('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-00000000000a') $$, 'P0001', 'The host cannot remove themselves; host transfer arrives in a later phase.', 'the host cannot remove themselves');
select throws_ok($$ select public.remove_player('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-00000000000d') $$, 'P0001', 'That user is not a member of this group.', 'removing a non-member is rejected');

select lives_ok($$ select public.remove_player('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-00000000000b') $$, 'the host removes the current turn holder');

reset role;
select is((select m.status from public.membership m where m.group_id = '88888888-8888-8888-8888-888888888888' and m.user_id = '00000000-0000-0000-0000-00000000000b'), 'removed'::public.membership_status, 'the removed player is marked removed, not deleted');
select is((select t.status from public.turn t where t.id = '88888888-8888-8888-8888-888888888802'), 'skipped'::public.turn_status, 'the removed holder''s live turn was resolved as skipped');
select ok(exists (select 1 from public.turn t where t.round_id = '88888888-8888-8888-8888-888888888801' and t.status = 'pending' and t.called_out_user_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e')), 'the relay advanced past the removed player to a remaining member');

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000a');
select pg_temp.ctx_set('remove_evan_res', public.remove_player('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-00000000000e')::text);
select ok((pg_temp.ctx_jsonb('remove_evan_res') ->> 'game_paused')::boolean, 'removing the second-to-last active member pauses the game (D029/D010)');

reset role;
select is((select g.status from public."group" g where g.id = '88888888-8888-8888-8888-888888888888'), 'paused'::public.group_status, 'the group is paused');
select is((select r.status from public.round r where r.id = '88888888-8888-8888-8888-888888888801'), 'force_closed'::public.round_status, 'the unfinishable round was force-closed');
select is((select count(*)::int from public.turn t where t.round_id = '88888888-8888-8888-8888-888888888801' and t.status = 'pending'), 0, 'no pending turn dangles in the force-closed round');

-- Resume: re-inviting the removed player and their acceptance restores the count and reopens play automatically (D029).
select pg_temp.impersonate('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.invite_player('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-00000000000b') $$, 'a removed player can be re-invited');

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000b');
select pg_temp.ctx_set('rejoin_res', public.respond_to_invite('88888888-8888-8888-8888-888888888888', true)::text);
select ok((pg_temp.ctx_jsonb('rejoin_res') ? 'round_id'), 'accepting into a paused group resumes play with a fresh round');

reset role;
select is((select g.status from public."group" g where g.id = '88888888-8888-8888-8888-888888888888'), 'active'::public.group_status, 'the group is active again');
select ok((select r.round_number = 2 and r.status = 'in_progress' from public.round r where r.id = (pg_temp.ctx_jsonb('rejoin_res') ->> 'round_id')::uuid), 'the resume opened round 2');
select ok(exists (select 1 from public.turn t where t.round_id = (pg_temp.ctx_jsonb('rejoin_res') ->> 'round_id')::uuid and t.status = 'pending' and t.called_out_user_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')), 'the resumed round has a pending system-picked turn');

-- Rescinding a pending invite deletes the row outright.
select pg_temp.impersonate('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.invite_player('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-00000000000d') $$, 'the host invites Dave');
select is((public.remove_player('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-00000000000d') ->> 'status'), 'invite_rescinded', 'removing an invited user rescinds the invite');

reset role;
select is((select count(*)::int from public.membership m where m.group_id = '88888888-8888-8888-8888-888888888888' and m.user_id = '00000000-0000-0000-0000-00000000000d'), 0, 'the rescinded invite row is gone');

-- ---------------------------------------------------------------------------
-- Server clock RPC (CLAUDE.md §2.1).
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('00000000-0000-0000-0000-00000000000a');
select ok((select abs(extract(epoch from (public.get_server_time() - now()))) < 5), 'get_server_time returns the server clock');

reset role;

select * from finish();
rollback;
