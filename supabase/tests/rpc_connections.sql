-- Phase 3B — pgTAP verification of the identity, connections, and join surface (run with `supabase test db`).
-- Covers short IDs (D032), deliberate exact-ID lookup with email excluded as a key (D056/D060/D061), instant adds (D033), removal (D038), auto-connect on acceptance with its once-per-pair-per-group ledger (D039/D048), the join code as the single group-sharing mechanism (D050/D051/D063) including the informational already-a-member outcome (D065), and the RLS/privilege posture of the new tables.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(63);

-- ---------------------------------------------------------------------------
-- Fixtures and impersonation plumbing (same pattern as rpc_core_loop.sql).
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-0000-0000-0000-000000000001', 'fay@callout.test', '{"display_name": "Fay"}'::jsonb),
  ('11111111-0000-0000-0000-000000000002', 'gus@callout.test', '{"display_name": "Gus"}'::jsonb),
  ('11111111-0000-0000-0000-000000000003', 'hana@callout.test', '{"display_name": "Hana"}'::jsonb),
  ('11111111-0000-0000-0000-000000000004', 'ivan@callout.test', '{"display_name": "Ivan"}'::jsonb),
  ('11111111-0000-0000-0000-000000000005', 'june@callout.test', '{"display_name": "June"}'::jsonb),
  ('11111111-0000-0000-0000-000000000006', 'kai@callout.test', '{"display_name": "Kai"}'::jsonb);

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

create function pg_temp.connected(user_one uuid, user_two uuid) returns boolean language sql as $$
  select exists (
    select 1 from public.connection c
    where c.user_a_id = least(user_one, user_two) and c.user_b_id = greatest(user_one, user_two)
  );
$$;

-- ---------------------------------------------------------------------------
-- Short IDs (D032): auto-assigned by the signup trigger path, unique, lookalike-free format.
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.profile p where p.id::text like '11111111-%' and p.short_id ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$'), 6, 'every new profile got an 8-character short ID from the lookalike-free alphabet (D032)');
select is((select count(distinct p.short_id)::int from public.profile p where p.id::text like '11111111-%'), 6, 'all short IDs are distinct');

select pg_temp.ctx_set('gus_code', (select p.short_id from public.profile p where p.id = '11111111-0000-0000-0000-000000000002'));

-- ---------------------------------------------------------------------------
-- find_user_by_short_id (D056/D060/D061): the exact Callout ID is the ONLY global lookup key — email finds nobody, names never leave the connections list (which filters client-side).
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');

select throws_ok($$ select * from public.find_user_by_short_id('  ') $$, 'P0001', 'Enter a Callout ID.', 'a blank lookup is rejected');
select is((select count(*)::int from public.find_user_by_short_id('22222222')), 0, 'an unknown ID finds nobody');
select ok((select s.user_id = '11111111-0000-0000-0000-000000000002' and s.display_name = 'Gus' and not s.is_connection from public.find_user_by_short_id((select val from ctx where key = 'gus_code')) s), 'a full exact Callout ID surfaces that one profile from the whole user base (D047)');
select is((select count(*)::int from public.find_user_by_short_id(lower((select val from ctx where key = 'gus_code')))), 1, 'exact ID matching is case-insensitive');
select is((select count(*)::int from public.find_user_by_short_id((select p.short_id from public.profile p where p.id = '11111111-0000-0000-0000-000000000001'))), 0, 'lookup never returns the caller themselves');
select is((select count(*)::int from public.find_user_by_short_id('gus@callout.test')), 0, 'an email finds nobody — it is not a lookup key anywhere (D060)');

-- ---------------------------------------------------------------------------
-- add_connection (D033/D056): search-then-select by user id, instant, idempotent.
-- ---------------------------------------------------------------------------

select throws_ok($$ select public.add_connection('11111111-0000-0000-0000-000000000001') $$, 'P0001', 'You cannot connect with yourself.', 'adding yourself is rejected');
select throws_ok($$ select public.add_connection('99999999-9999-9999-9999-999999999999') $$, 'P0001', 'That user does not exist.', 'adding an unknown user id is rejected');

select pg_temp.ctx_set('add_gus_res', public.add_connection('11111111-0000-0000-0000-000000000002')::text);
select ok((pg_temp.ctx_jsonb('add_gus_res') ->> 'display_name') = 'Gus' and (pg_temp.ctx_jsonb('add_gus_res') ->> 'already_connected')::boolean = false, 'adding a searched profile completes instantly with no accept step (D033)');

reset role;
select ok(pg_temp.connected('11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002'), 'the connection row exists, canonicalized to one row per pair');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select ok((public.add_connection('11111111-0000-0000-0000-000000000002') ->> 'already_connected')::boolean, 're-adding an existing connection reports already_connected');

reset role;
select is((select count(*)::int from public.connection c where c.user_a_id = '11111111-0000-0000-0000-000000000001' or c.user_b_id = '11111111-0000-0000-0000-000000000001'), 1, 're-adding never duplicates the pair row');

-- Looking up an existing connection reports the relationship, so pickers can render it without a "+" badge (D061).
select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select ok((select s.is_connection from public.find_user_by_short_id((select val from ctx where key = 'gus_code')) s), 'lookup flags an existing connection as one (D061)');

-- ---------------------------------------------------------------------------
-- RLS and privilege posture: connections are participant-visible only; profiles open up to connections; nothing new is client-writable, and short_id is not self-updatable.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-0000-0000-0000-000000000002');
select is((select count(*)::int from public.profile p where p.id = '11111111-0000-0000-0000-000000000001'), 1, 'a connected user can read the profile without sharing any group (D033)');
select is((select count(*)::int from public.connection), 1, 'a user sees only connection rows they participate in');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000005');
select is((select count(*)::int from public.profile p where p.id = '11111111-0000-0000-0000-000000000001'), 0, 'an unconnected user with no shared group cannot read the profile');
select is((select count(*)::int from public.connection), 0, 'an unconnected user sees no connection rows at all');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.connection (user_a_id, user_b_id) values ('11111111-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000005') $$, '42501', null, 'clients cannot insert connection rows directly (CLAUDE.md §2.2)');
select throws_ok($$ insert into public.join_request (group_id, user_id) values (gen_random_uuid(), '11111111-0000-0000-0000-000000000001') $$, '42501', null, 'clients cannot insert join_request rows directly');
select throws_ok($$ update public.profile set short_id = 'AAAAAAAA' where id = '11111111-0000-0000-0000-000000000001' $$, '42501', null, 'short_id is excluded from the self-update column grant (D032)');

set local role anon;
select throws_ok($$ select public.add_connection('11111111-0000-0000-0000-000000000002') $$, '42501', null, 'anon cannot execute the connection RPCs');
reset role;

-- ---------------------------------------------------------------------------
-- remove_connection (D038): idempotent, group-independent.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select is((public.remove_connection('11111111-0000-0000-0000-000000000002') ->> 'status'), 'removed', 'removing a connection succeeds');

reset role;
select ok(not pg_temp.connected('11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002'), 'the pair row is gone');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select is((public.remove_connection('11111111-0000-0000-0000-000000000002') ->> 'status'), 'removed', 'removing an already-removed connection is an idempotent success');

-- ---------------------------------------------------------------------------
-- D047/D049: creation is settings-only; invites reach anyone, connections not required.
-- ---------------------------------------------------------------------------

select pg_temp.ctx_set('group1_res', public.create_group('Inner Circle', 60)::text);
select pg_temp.ctx_set('group1', pg_temp.ctx_jsonb('group1_res') ->> 'group_id');
select ok((pg_temp.ctx_jsonb('group1_res') ->> 'join_code') ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$', 'creation assigns a persistent 8-character join code (D050)');

select lives_ok(format($f$ select public.invite_player('%s', '11111111-0000-0000-0000-000000000003') $f$, pg_temp.ctx_uuid('group1')), 'the host invites Hana — no connection required (D047)');
select lives_ok(format($f$ select public.invite_player('%s', '11111111-0000-0000-0000-000000000004') $f$, pg_temp.ctx_uuid('group1')), 'the host invites Ivan — no connection required (D047)');

reset role;
select ok(not pg_temp.connected('11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000003'), 'inviting alone connects nobody — auto-connect waits for acceptance (D048)');

-- ---------------------------------------------------------------------------
-- D039/D048: auto-connect fires when membership is accepted, once per pair per group.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-0000-0000-0000-000000000003');
select lives_ok(format($f$ select public.respond_to_invite('%s', true) $f$, pg_temp.ctx_uuid('group1')), 'Hana accepts her invite');
select pg_temp.impersonate('11111111-0000-0000-0000-000000000004');
select lives_ok(format($f$ select public.respond_to_invite('%s', true) $f$, pg_temp.ctx_uuid('group1')), 'Ivan accepts his invite');

reset role;
select ok(pg_temp.connected('11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000003') and pg_temp.connected('11111111-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000004'), 'acceptance auto-connected the new member with every confirmed co-member (D039/D048)');
select is((select count(*)::int from private.connection_event e where e.group_id = pg_temp.ctx_uuid('group1')), 3, 'the ledger recorded one event per pair for the group (D039)');

-- Removing the connection while both remain in the group: a rejoin must NOT resurrect it — the pair+group event already fired.
select pg_temp.impersonate('11111111-0000-0000-0000-000000000003');
select is((public.remove_connection('11111111-0000-0000-0000-000000000004') ->> 'status'), 'removed', 'Hana removes her auto-created connection with Ivan');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select lives_ok(format($f$ select public.remove_player('%s', '11111111-0000-0000-0000-000000000004') $f$, pg_temp.ctx_uuid('group1')), 'the host removes Ivan from the group');
select lives_ok(format($f$ select public.invite_player('%s', '11111111-0000-0000-0000-000000000004') $f$, pg_temp.ctx_uuid('group1')), 'the host re-invites Ivan');
select pg_temp.impersonate('11111111-0000-0000-0000-000000000004');
select lives_ok(format($f$ select public.respond_to_invite('%s', true) $f$, pg_temp.ctx_uuid('group1')), 'Ivan rejoins the same group');

reset role;
select ok(not pg_temp.connected('11111111-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000004'), 'rejoining the SAME group does not resurrect a removed connection — once per pair per group (D039)');

-- A different shared group is a new event for the pair and reconnects them.
select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select pg_temp.ctx_set('group2', (public.create_group('Second Circle', 60) ->> 'group_id'));
select lives_ok(format($f$ select public.invite_player('%s', '11111111-0000-0000-0000-000000000003') $f$, pg_temp.ctx_uuid('group2')), 'Hana is invited to the second group');
select lives_ok(format($f$ select public.invite_player('%s', '11111111-0000-0000-0000-000000000004') $f$, pg_temp.ctx_uuid('group2')), 'Ivan is invited to the second group');
select pg_temp.impersonate('11111111-0000-0000-0000-000000000003');
select lives_ok(format($f$ select public.respond_to_invite('%s', true) $f$, pg_temp.ctx_uuid('group2')), 'Hana accepts into the second group');
select pg_temp.impersonate('11111111-0000-0000-0000-000000000004');
select lives_ok(format($f$ select public.respond_to_invite('%s', true) $f$, pg_temp.ctx_uuid('group2')), 'Ivan accepts into the second group');

reset role;
select ok(pg_temp.connected('11111111-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000004'), 'a later, different shared group auto-connects the same pair again (D038/D039)');

-- ---------------------------------------------------------------------------
-- Join by code (D050/D051/D063 — the single group-sharing mechanism): instant pre-start, request-approval once started, reusable by everyone, removed members always need approval, informational already-a-member outcome (D065).
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select pg_temp.ctx_set('group3_res', public.create_group('Code Crew', 60)::text);
select pg_temp.ctx_set('group3', pg_temp.ctx_jsonb('group3_res') ->> 'group_id');
select pg_temp.ctx_set('code3', pg_temp.ctx_jsonb('group3_res') ->> 'join_code');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000006');
select throws_ok($$ select public.join_group_by_code('22222222') $$, 'P0001', 'No group was found with that code. Double-check it and try again.', 'an unknown code reports not found');
select is((public.join_group_by_code(lower(pg_temp.ctx_jsonb('group3_res') ->> 'join_code')) ->> 'status'), 'joined', 'entering the code pre-start joins immediately, case-insensitively, with no approval (D051)');

reset role;
select ok((select m.status = 'active' and m.role = 'player' from public.membership m where m.group_id = pg_temp.ctx_uuid('group3') and m.user_id = '11111111-0000-0000-0000-000000000006'), 'the pre-start code entrant is an active player');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000006');
select ok((select r ->> 'status' = 'already_member' and r ->> 'group_name' = 'Code Crew' from public.join_group_by_code(pg_temp.ctx_jsonb('group3_res') ->> 'join_code') r), 're-entering the code as a member is an informational already_member outcome carrying the group, not an error (D065)');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select lives_ok(format($f$ select public.start_game('%s') $f$, pg_temp.ctx_uuid('group3')), 'the host starts the game with the code entrant aboard');

-- Once active, the same code creates a pending request instead (D051), idempotently.
select pg_temp.impersonate('11111111-0000-0000-0000-000000000005');
select is((public.join_group_by_code(pg_temp.ctx_jsonb('group3_res') ->> 'join_code') ->> 'status'), 'request_pending', 'entering the code once the group is active creates a pending join request (D051)');
select is((public.join_group_by_code(pg_temp.ctx_jsonb('group3_res') ->> 'join_code') ->> 'status'), 'request_pending', 're-entering the code while a request is pending is an idempotent no-op');

reset role;
select is((select count(*)::int from public.join_request jr where jr.group_id = pg_temp.ctx_uuid('group3')), 1, 'exactly one request row exists');

-- The code stays valid for others regardless of June's pending request.
select pg_temp.impersonate('11111111-0000-0000-0000-000000000002');
select is((public.join_group_by_code(pg_temp.ctx_jsonb('group3_res') ->> 'join_code') ->> 'status'), 'request_pending', 'the code is reusable — one person''s outcome never blocks another (D051)');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000005');
select throws_ok(format($f$ select public.respond_join_request('%s', '11111111-0000-0000-0000-000000000005', true) $f$, pg_temp.ctx_uuid('group3')), 'P0001', 'Only the host can respond to join requests.', 'a non-host cannot respond to join requests');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select is((public.respond_join_request(pg_temp.ctx_uuid('group3'), '11111111-0000-0000-0000-000000000005', true) ->> 'status'), 'approved', 'the host approves a join request');
select is((public.respond_join_request(pg_temp.ctx_uuid('group3'), '11111111-0000-0000-0000-000000000002', false) ->> 'status'), 'declined', 'the host declines a join request');
select throws_ok(format($f$ select public.respond_join_request('%s', '11111111-0000-0000-0000-000000000002', true) $f$, pg_temp.ctx_uuid('group3')), 'P0001', 'No pending join request from that user.', 'responding twice to the same request fails cleanly');

reset role;
select ok((select m.status = 'active' from public.membership m where m.group_id = pg_temp.ctx_uuid('group3') and m.user_id = '11111111-0000-0000-0000-000000000005'), 'the approved requester is an active member');
select is((select count(*)::int from public.membership m where m.group_id = pg_temp.ctx_uuid('group3') and m.user_id = '11111111-0000-0000-0000-000000000002'), 0, 'the declined requester got no membership');
select is((select count(*)::int from public.join_request jr where jr.group_id = pg_temp.ctx_uuid('group3')), 0, 'both requests were cleared by the responses');
select ok(pg_temp.connected('11111111-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000006'), 'approval auto-connected the joiner with co-members (D039/D048)');

-- Removed members go through approval even though the code would otherwise be instant.
select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select lives_ok(format($f$ select public.remove_player('%s', '11111111-0000-0000-0000-000000000006') $f$, pg_temp.ctx_uuid('group3')), 'the host removes the code entrant');
select pg_temp.impersonate('11111111-0000-0000-0000-000000000006');
select is((public.join_group_by_code(pg_temp.ctx_jsonb('group3_res') ->> 'join_code') ->> 'status'), 'request_pending', 'a removed member re-entering the code needs host approval, never silent re-entry');

select * from finish();
rollback;
