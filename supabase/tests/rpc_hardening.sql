-- Phase 4 — MVP hardening: pgTAP verification of the edge cases plan.md Phase 4 names, deliberately complementing (not repeating) rpc_core_loop.sql. Covers the exact deadline boundary from both sides (the player's submit/pick and the job's expiry are both valid moves at the same instant, serialized by the group lock), round completion through every non-submit resolution path (last player misses, last player skipped, removal emptying the eligible pool mid-hand-off), the minimum-group-size boundary crossed from below in a setup-state group, the D010 25-member cap on both invite paths, and single-session idempotency re-checks. References: decisions.md D029 (as amended by D042), D010, D012, D014.
-- Fixtures are seeded directly with fixed uuids (the rpc_core_loop.sql removal-section pattern) so every holder is deterministic — no property-only assertions needed here.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(28);

-- ---------------------------------------------------------------------------
-- Fixtures and impersonation plumbing (same conventions as rpc_core_loop.sql).
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('99999999-0000-0000-0000-000000000001', 'hard.alice@callout.test', '{"display_name": "Hard Alice"}'::jsonb),
  ('99999999-0000-0000-0000-000000000002', 'hard.bob@callout.test', '{"display_name": "Hard Bob"}'::jsonb),
  ('99999999-0000-0000-0000-000000000003', 'hard.cara@callout.test', '{"display_name": "Hard Cara"}'::jsonb),
  ('99999999-0000-0000-0000-000000000004', 'hard.dave@callout.test', '{"display_name": "Hard Dave"}'::jsonb);

-- 25 throwaway users for the D010 cap tests.
insert into auth.users (id, email, raw_user_meta_data)
select format('99999999-0000-0000-0000-%s', lpad((100 + n)::text, 12, '0'))::uuid,
       format('hard.cap%s@callout.test', n),
       jsonb_build_object('display_name', format('Cap %s', n))
from generate_series(1, 25) as n;

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
-- Deadline boundary timing. Inside one transaction now() is frozen, so deadline_at = now() IS the boundary instant, exactly reproducible. The player-side checks use strict > (a submit or pick landing exactly at the deadline is still accepted); the job uses <= (a turn whose deadline equals now() is already expired). Both are therefore valid moves at the same instant — the group lock serializes them and the first to commit wins, which is the intended semantic, not a contradiction.
-- ---------------------------------------------------------------------------

insert into public."group" (id, name, host_id, per_turn_deadline, status) values
  ('99999999-0000-0000-0001-000000000000', 'Boundary Group', '99999999-0000-0000-0000-000000000001', interval '1 hour', 'active');
insert into public.membership (group_id, user_id, role, status, joined_at) values
  ('99999999-0000-0000-0001-000000000000', '99999999-0000-0000-0000-000000000001', 'host', 'active', now()),
  ('99999999-0000-0000-0001-000000000000', '99999999-0000-0000-0000-000000000002', 'player', 'active', now()),
  ('99999999-0000-0000-0001-000000000000', '99999999-0000-0000-0000-000000000003', 'player', 'active', now());
insert into public.round (id, group_id, round_number, status) values
  ('99999999-0000-0000-0001-000000000001', '99999999-0000-0000-0001-000000000000', 1, 'in_progress');
insert into public.turn (id, round_id, group_id, called_out_user_id, deadline_at, status) values
  ('99999999-0000-0000-0001-000000000002', '99999999-0000-0000-0001-000000000001', '99999999-0000-0000-0001-000000000000', '99999999-0000-0000-0000-000000000002', now(), 'pending');

select pg_temp.impersonate('99999999-0000-0000-0000-000000000002');
select pg_temp.ctx_set('boundary_submit', public.submit_turn('99999999-0000-0000-0001-000000000002', 'Right at the buzzer')::text);
select ok((pg_temp.ctx_jsonb('boundary_submit') ->> 'handoff_required')::boolean, 'a submission landing exactly at deadline_at is accepted — the player-side boundary is inclusive');

-- Rewind the D042 pick window to the boundary instant: picking exactly at the pick deadline is likewise still allowed.
reset role;
update public.turn set deadline_at = now() where id = '99999999-0000-0000-0001-000000000002';

select pg_temp.impersonate('99999999-0000-0000-0000-000000000002');
select lives_ok($$ select public.call_out_player('99999999-0000-0000-0001-000000000002', '99999999-0000-0000-0000-000000000003') $$, 'a hand-off landing exactly at the pick deadline is accepted (D042 boundary inclusive)');

reset role;
select pg_temp.ctx_set('boundary_turn2', (select t.id::text from public.turn t where t.round_id = '99999999-0000-0000-0001-000000000001' and t.status = 'pending'));
select ok((select t.called_out_user_id = '99999999-0000-0000-0000-000000000003' from public.turn t where t.id = pg_temp.ctx_uuid('boundary_turn2')), 'the boundary hand-off created the pending turn for the picked player');

-- One microsecond past the deadline is the other side of the boundary: rejected before the job has ever run.
update public.turn set deadline_at = now() - interval '1 microsecond' where id = pg_temp.ctx_uuid('boundary_turn2');
select pg_temp.impersonate('99999999-0000-0000-0000-000000000003');
select throws_ok(format($f$ select public.submit_turn('%s', 'One microsecond too slow') $f$, pg_temp.ctx_uuid('boundary_turn2')), 'P0001', 'The deadline for this turn has passed.', 'a submission one microsecond past deadline_at is rejected (strict player-side boundary)');

-- The job's side of the same instant: deadline_at = now() is already expired for the scheduler (<=), so at the exact boundary the outcome is whoever wins the group lock.
reset role;
update public.turn set deadline_at = now() where id = pg_temp.ctx_uuid('boundary_turn2');
select private.advance_expired_turns();

select is((select t.status from public.turn t where t.id = pg_temp.ctx_uuid('boundary_turn2')), 'missed'::public.turn_status, 'the job treats deadline_at exactly at now() as expired — the job-side boundary is inclusive');
select ok(exists (select 1 from public.turn t where t.round_id = '99999999-0000-0000-0001-000000000001' and t.status = 'pending' and t.called_out_user_id = '99999999-0000-0000-0000-000000000001' and t.called_by_user_id is null), 'the miss advanced to the only member who had not gone this round');

-- ---------------------------------------------------------------------------
-- Round completion when the LAST eligible player misses (rpc_core_loop covers the last-submit close; the miss path exercises advance_after finding an empty pool).
-- ---------------------------------------------------------------------------

update public.turn set deadline_at = now() - interval '1 second' where round_id = '99999999-0000-0000-0001-000000000001' and status = 'pending';
select private.advance_expired_turns();

select is((select r.status from public.round r where r.id = '99999999-0000-0000-0001-000000000001'), 'completed'::public.round_status, 'the last eligible player missing completes the round — a miss counts as resolution, not a stall');
select pg_temp.ctx_set('boundary_round2', (select r.id::text from public.round r where r.group_id = '99999999-0000-0000-0001-000000000000' and r.status = 'in_progress'));
select ok((select r.round_number = 2 from public.round r where r.id = pg_temp.ctx_uuid('boundary_round2')), 'the miss-completed round rolled straight into round 2');
select ok(exists (select 1 from public.turn t where t.round_id = pg_temp.ctx_uuid('boundary_round2') and t.status = 'pending' and t.called_by_user_id is null and t.called_out_user_id in ('99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000003')), 'round 2 opens with a system pick that excludes the player whose miss closed round 1 (D029 back-to-back exclusion)');

-- ---------------------------------------------------------------------------
-- Round completion when the LAST eligible player is skipped: the host skipping the only remaining player closes the round like a miss would.
-- ---------------------------------------------------------------------------

insert into public."group" (id, name, host_id, per_turn_deadline, status) values
  ('99999999-0000-0000-0002-000000000000', 'Skip Close Group', '99999999-0000-0000-0000-000000000001', interval '1 hour', 'active');
insert into public.membership (group_id, user_id, role, status, joined_at) values
  ('99999999-0000-0000-0002-000000000000', '99999999-0000-0000-0000-000000000001', 'host', 'active', now()),
  ('99999999-0000-0000-0002-000000000000', '99999999-0000-0000-0000-000000000002', 'player', 'active', now());
insert into public.round (id, group_id, round_number, status) values
  ('99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0002-000000000000', 1, 'in_progress');
-- The host already went (created_at nudged earlier so the pending turn is unambiguously the round's latest).
insert into public.turn (id, round_id, group_id, called_out_user_id, deadline_at, status, created_at) values
  ('99999999-0000-0000-0002-000000000002', '99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0002-000000000000', '99999999-0000-0000-0000-000000000001', now() + interval '1 hour', 'submitted', clock_timestamp() - interval '1 minute'),
  ('99999999-0000-0000-0002-000000000003', '99999999-0000-0000-0002-000000000001', '99999999-0000-0000-0002-000000000000', '99999999-0000-0000-0000-000000000002', now() + interval '1 hour', 'pending', clock_timestamp());

select pg_temp.impersonate('99999999-0000-0000-0000-000000000001');
select pg_temp.ctx_set('skip_close_res', public.skip_turn('99999999-0000-0000-0002-000000000003')::text);
select ok((pg_temp.ctx_jsonb('skip_close_res') ->> 'round_completed')::boolean, 'skipping the last eligible player completes the round instead of dangling it');

reset role;
select is((select r.status from public.round r where r.id = '99999999-0000-0000-0002-000000000001'), 'completed'::public.round_status, 'the skip-closed round is marked completed, not force_closed — a skip is a normal resolution (D029)');
select ok(exists (select 1 from public.turn t join public.round r on r.id = t.round_id where r.group_id = '99999999-0000-0000-0002-000000000000' and r.round_number = 2 and t.status = 'pending' and t.called_by_user_id is null and t.called_out_user_id = '99999999-0000-0000-0000-000000000001'), 'the rollover opened round 2 on the other member — the skipped player is excluded from the opening pick (D029)');

-- ---------------------------------------------------------------------------
-- Removal that empties the eligible pool while a hand-off is pending: the submitted turn's pick window becomes moot and the round completes (the remove_player branch rpc_core_loop does not reach).
-- ---------------------------------------------------------------------------

insert into public."group" (id, name, host_id, per_turn_deadline, status) values
  ('99999999-0000-0000-0003-000000000000', 'Pool Drain Group', '99999999-0000-0000-0000-000000000001', interval '1 hour', 'active');
insert into public.membership (group_id, user_id, role, status, joined_at) values
  ('99999999-0000-0000-0003-000000000000', '99999999-0000-0000-0000-000000000001', 'host', 'active', now()),
  ('99999999-0000-0000-0003-000000000000', '99999999-0000-0000-0000-000000000002', 'player', 'active', now()),
  ('99999999-0000-0000-0003-000000000000', '99999999-0000-0000-0000-000000000003', 'player', 'active', now());
insert into public.round (id, group_id, round_number, status) values
  ('99999999-0000-0000-0003-000000000001', '99999999-0000-0000-0003-000000000000', 1, 'in_progress');
-- Host missed earlier; Cara submitted and holds the live D042 pick window; Bob is the entire remaining eligible pool.
insert into public.turn (id, round_id, group_id, called_out_user_id, deadline_at, status, created_at) values
  ('99999999-0000-0000-0003-000000000002', '99999999-0000-0000-0003-000000000001', '99999999-0000-0000-0003-000000000000', '99999999-0000-0000-0000-000000000001', now() - interval '10 minutes', 'missed', clock_timestamp() - interval '1 minute'),
  ('99999999-0000-0000-0003-000000000003', '99999999-0000-0000-0003-000000000001', '99999999-0000-0000-0003-000000000000', '99999999-0000-0000-0000-000000000003', now() + interval '5 minutes', 'submitted', clock_timestamp());

select pg_temp.impersonate('99999999-0000-0000-0000-000000000001');
select pg_temp.ctx_set('pool_drain_res', public.remove_player('99999999-0000-0000-0003-000000000000', '99999999-0000-0000-0000-000000000002')::text);
select ok((pg_temp.ctx_jsonb('pool_drain_res') ->> 'round_completed')::boolean, 'removing the only remaining eligible player during a pending hand-off completes the round');

reset role;
select is((select r.status from public.round r where r.id = '99999999-0000-0000-0003-000000000001'), 'completed'::public.round_status, 'the drained round is completed — the submitted turn needed no successor once nobody was left to pick');
select ok(exists (select 1 from public.turn t join public.round r on r.id = t.round_id where r.group_id = '99999999-0000-0000-0003-000000000000' and r.round_number = 2 and t.status = 'pending' and t.called_by_user_id is null and t.called_out_user_id = '99999999-0000-0000-0000-000000000001'), 'round 2 opens on the host: the last submitter is excluded (D029) and the removed player is never picked (CLAUDE.md §2.3)');

-- ---------------------------------------------------------------------------
-- Minimum group size crossed from below in a setup-state group: removal before start has no round side effects, start stays blocked under two active members, and re-inviting across the boundary unblocks it (D010).
-- ---------------------------------------------------------------------------

insert into public."group" (id, name, host_id, per_turn_deadline, status) values
  ('99999999-0000-0000-0004-000000000000', 'Setup Boundary Group', '99999999-0000-0000-0000-000000000001', interval '1 hour', 'setup');
insert into public.membership (group_id, user_id, role, status, joined_at) values
  ('99999999-0000-0000-0004-000000000000', '99999999-0000-0000-0000-000000000001', 'host', 'active', now()),
  ('99999999-0000-0000-0004-000000000000', '99999999-0000-0000-0000-000000000002', 'player', 'active', now());

select pg_temp.impersonate('99999999-0000-0000-0000-000000000001');
select is((public.remove_player('99999999-0000-0000-0004-000000000000', '99999999-0000-0000-0000-000000000002') ->> 'status'), 'removed', 'the host can remove a joined player before the game starts');

reset role;
select ok((select g.status = 'setup' from public."group" g where g.id = '99999999-0000-0000-0004-000000000000') and not exists (select 1 from public.round r where r.group_id = '99999999-0000-0000-0004-000000000000'), 'pre-start removal leaves the group in setup with no rounds touched');

select pg_temp.impersonate('99999999-0000-0000-0000-000000000001');
select throws_ok($$ select public.start_game('99999999-0000-0000-0004-000000000000') $$, 'P0001', 'At least 2 joined members are needed to start.', 'start stays blocked at one active member (D010)');
select lives_ok($$ select public.invite_player('99999999-0000-0000-0004-000000000000', '99999999-0000-0000-0000-000000000002') $$, 'the removed player can be re-invited pre-start');

select pg_temp.impersonate('99999999-0000-0000-0000-000000000002');
select pg_temp.ctx_set('setup_rejoin', public.respond_to_invite('99999999-0000-0000-0004-000000000000', true)::text);
select ok((pg_temp.ctx_jsonb('setup_rejoin') ->> 'status') = 'joined' and not (pg_temp.ctx_jsonb('setup_rejoin') ? 'round_id'), 'accepting into a setup group does not auto-open a round — only paused groups resume on acceptance (D029)');

select pg_temp.impersonate('99999999-0000-0000-0000-000000000001');
select pg_temp.ctx_set('setup_start', public.start_game('99999999-0000-0000-0004-000000000000')::text);
select ok((pg_temp.ctx_jsonb('setup_start') ? 'round_id') and (pg_temp.ctx_jsonb('setup_start') ? 'turn_id'), 'crossing back to two active members makes start work — the boundary is exactly two (D010)');

-- A game already running cannot be started again.
select throws_ok($$ select public.start_game('99999999-0000-0000-0001-000000000000') $$, 'P0001', 'This game has already started.', 'start_game rejects a group that is already active');

-- ---------------------------------------------------------------------------
-- The D010 cap of 25 members. Creation is settings-only since D049, so the cap is enforced entirely by invite_player; the boundary is pinned from both sides — the 25th member is accepted, the 26th is not, and pending invites count.
-- ---------------------------------------------------------------------------

reset role;
insert into public."group" (id, name, host_id, per_turn_deadline, status) values
  ('99999999-0000-0000-0005-000000000000', 'Cap Group', '99999999-0000-0000-0000-000000000001', interval '1 hour', 'setup');
insert into public.membership (group_id, user_id, role, status, joined_at) values
  ('99999999-0000-0000-0005-000000000000', '99999999-0000-0000-0000-000000000001', 'host', 'active', now());
-- 23 pending invites bring the count to 24, one under the cap.
insert into public.membership (group_id, user_id, role, status)
select '99999999-0000-0000-0005-000000000000', format('99999999-0000-0000-0000-%s', lpad((100 + n)::text, 12, '0'))::uuid, 'player', 'invited'
from generate_series(1, 23) as n;

select pg_temp.impersonate('99999999-0000-0000-0000-000000000001');
select lives_ok($$ select public.invite_player('99999999-0000-0000-0005-000000000000', '99999999-0000-0000-0000-000000000124') $$, 'the 25th member is accepted — the cap is inclusive (D010)');
select is((select count(*)::int from public.membership m where m.group_id = '99999999-0000-0000-0005-000000000000'), 25, 'the group sits exactly at the 25-member cap, pending invites included');
select throws_ok($$ select public.invite_player('99999999-0000-0000-0005-000000000000', '99999999-0000-0000-0000-000000000125') $$, 'P0001', 'This group is full.', 'the 26th member is rejected — pending invites count toward the cap (D010)');

-- ---------------------------------------------------------------------------
-- Single-session idempotency re-checks: a resolved turn cannot resolve twice, and the job never touches unexpired state.
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.ctx_set('idem_turn', pg_temp.ctx_jsonb('setup_start') ->> 'turn_id');
select pg_temp.ctx_set('idem_holder', (select t.called_out_user_id::text from public.turn t where t.id = pg_temp.ctx_uuid('idem_turn')));

select pg_temp.impersonate(pg_temp.ctx_uuid('idem_holder'));
select pg_temp.ctx_set('idem_submit', public.submit_turn(pg_temp.ctx_uuid('idem_turn'), 'Once and only once')::text);
select ok((pg_temp.ctx_jsonb('idem_submit') ? 'submission_id'), 'the holder submits their turn once');
select throws_ok(format($f$ select public.submit_turn('%s', 'Twice?') $f$, pg_temp.ctx_uuid('idem_turn')), 'P0001', 'This turn has already been resolved.', 'a second submit of the same turn is rejected — resolution is one-way (CLAUDE.md §2.7)');

reset role;
select pg_temp.ctx_set('turn_count_before', (select count(*)::text from public.turn));
select private.advance_expired_turns();
select is((select count(*)::text from public.turn), (select val from ctx where key = 'turn_count_before'), 'the job leaves every unexpired turn untouched — no advance happens without an expired deadline');

select * from finish();
rollback;
