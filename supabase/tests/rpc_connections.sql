-- Phase 3B — pgTAP verification of the identity, connections, and join surface (run with `supabase test db`).
-- Covers short IDs (D032), search-then-select adds with global exact match and connections-scoped name search (D047/D056/D034), removal (D038), auto-connect on acceptance with its once-per-pair-per-group ledger (D039/D048), group join codes with pre-start instant join and post-start request approval (D050/D051), share invites scoped to new signups (D036/D052/D054), the profile connect link (D055), and the RLS/privilege posture of the new tables.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(83);

-- ---------------------------------------------------------------------------
-- Fixtures and impersonation plumbing (same pattern as rpc_core_loop.sql). Kai is backdated a day so the D054 "new signups only" rule has an existing-account persona to reject; everyone else shares the transaction timestamp and so counts as new relative to any token minted in this suite.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-0000-0000-0000-000000000001', 'fay@callout.test', '{"display_name": "Fay"}'::jsonb),
  ('11111111-0000-0000-0000-000000000002', 'gus@callout.test', '{"display_name": "Gus"}'::jsonb),
  ('11111111-0000-0000-0000-000000000003', 'hana@callout.test', '{"display_name": "Hana"}'::jsonb),
  ('11111111-0000-0000-0000-000000000004', 'ivan@callout.test', '{"display_name": "Ivan"}'::jsonb),
  ('11111111-0000-0000-0000-000000000005', 'june@callout.test', '{"display_name": "June"}'::jsonb);
insert into auth.users (id, email, raw_user_meta_data, created_at) values
  ('11111111-0000-0000-0000-000000000006', 'kai@callout.test', '{"display_name": "Kai"}'::jsonb, now() - interval '1 day');

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
-- search_users (D047/D056/D034): global exact match on ID/email, name search scoped to connections only.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');

select throws_ok($$ select * from public.search_users('g') $$, 'P0001', 'Type at least 2 characters to search.', 'search rejects queries under 2 characters');
select is((select count(*)::int from public.search_users('gus')), 0, 'a name search finds nothing outside the caller''s connections — the global user base is not name-searchable (D034/D047)');
select ok((select s.user_id = '11111111-0000-0000-0000-000000000002' and s.exact_match and not s.is_connection from public.search_users((select val from ctx where key = 'gus_code')) s), 'a full exact Callout ID surfaces that one profile from the whole user base (D047)');
select ok((select s.display_name = 'Hana' and s.exact_match from public.search_users('hana@callout.test') s), 'a full exact email surfaces that one profile from the whole user base (D047/D056)');
select is((select count(*)::int from public.search_users(lower((select val from ctx where key = 'gus_code')))), 1, 'exact ID matching is case-insensitive');
select is((select count(*)::int from public.search_users('fay@callout.test')), 0, 'search never returns the caller themselves');

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

-- Name search now finds the new connection (D034's scope working from the inside).
select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select ok((select s.is_connection and not s.exact_match from public.search_users('gus') s where s.user_id = '11111111-0000-0000-0000-000000000002'), 'a name search finds people inside the caller''s connections (D034)');

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
select throws_ok($$ insert into public.share_invite (group_id, inviter_user_id) values (null, '11111111-0000-0000-0000-000000000001') $$, '42501', null, 'clients cannot insert share_invite rows directly');
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
-- Share invites (D036/D052/D054): host-only creation, exact-token preview, single-use claim that joins and connects — for new signups only.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-0000-0000-0000-000000000003');
select throws_ok(format($f$ select public.create_share_invite('%s') $f$, pg_temp.ctx_uuid('group1')), 'P0001', 'Only the host can create invite links.', 'a non-host cannot create a share invite');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select pg_temp.ctx_set('invite1', public.create_share_invite(pg_temp.ctx_uuid('group1'))::text);
select ok((pg_temp.ctx_jsonb('invite1') ->> 'token') ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{16}$', 'the share token is a 16-character code from the lookalike-free alphabet (D036)');

select throws_ok($$ select public.preview_share_invite('2222222222222222') $$, 'P0001', 'That invite link is not valid.', 'previewing an unknown token reports not valid');

-- Kai's account predates the token (backdated fixture): personal share links are for new signups only (D054).
select pg_temp.impersonate('11111111-0000-0000-0000-000000000006');
select throws_ok(format($f$ select public.claim_share_invite('%s') $f$, pg_temp.ctx_jsonb('invite1') ->> 'token'), 'P0001', 'This link is for people new to Callout — ask for the group code and use Join Group instead.', 'an account that predates the link cannot claim it (D054)');

-- June signed up alongside the token (same-transaction timestamp counts as new) and is a total outsider: the token alone grants preview and entry.
select pg_temp.impersonate('11111111-0000-0000-0000-000000000005');
select pg_temp.ctx_set('preview1', public.preview_share_invite(pg_temp.ctx_jsonb('invite1') ->> 'token')::text);
select ok((pg_temp.ctx_jsonb('preview1') ->> 'kind') = 'group' and (pg_temp.ctx_jsonb('preview1') ->> 'group_name') = 'Inner Circle' and (pg_temp.ctx_jsonb('preview1') ->> 'inviter_name') = 'Fay' and (pg_temp.ctx_jsonb('preview1') ->> 'status') = 'valid', 'preview shows the kind, group, inviter, and validity by exact token');

select pg_temp.ctx_set('claim1', public.claim_share_invite(pg_temp.ctx_jsonb('invite1') ->> 'token')::text);
select is((pg_temp.ctx_jsonb('claim1') ->> 'status'), 'joined', 'claiming the token joins the group');

reset role;
select ok((select m.status = 'active' and m.role = 'player' and m.joined_at is not null from public.membership m where m.group_id = pg_temp.ctx_uuid('group1') and m.user_id = '11111111-0000-0000-0000-000000000005'), 'the claimant became an active player with no separate accept step (D036)');
select ok((select si.consumed_at is not null and si.consumed_by_user_id = '11111111-0000-0000-0000-000000000005' from public.share_invite si where si.id = (pg_temp.ctx_jsonb('invite1') ->> 'share_invite_id')::uuid), 'the token was consumed by the claim');
select ok(pg_temp.connected('11111111-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001'), 'the claimant was auto-connected with the inviter in the same action (D036)');
select ok(pg_temp.connected('11111111-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000003'), 'the claimant was auto-connected with existing co-members too (D039)');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000005');
select is((public.claim_share_invite(pg_temp.ctx_jsonb('invite1') ->> 'token') ->> 'status'), 'joined', 'the claimant retrying their own claim is an idempotent success (CLAUDE.md §2.7)');
select is((public.preview_share_invite(pg_temp.ctx_jsonb('invite1') ->> 'token') ->> 'status'), 'used', 'preview reports a consumed token as used');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000002');
select throws_ok(format($f$ select public.claim_share_invite('%s') $f$, pg_temp.ctx_jsonb('invite1') ->> 'token'), 'P0001', 'That invite link has already been used.', 'a second person cannot claim a consumed token — single-use (D036)');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select pg_temp.ctx_set('invite2', public.create_share_invite(pg_temp.ctx_uuid('group1'))::text);
select pg_temp.impersonate('11111111-0000-0000-0000-000000000003');
select throws_ok(format($f$ select public.claim_share_invite('%s') $f$, pg_temp.ctx_jsonb('invite2') ->> 'token'), 'P0001', 'You are already a member of this group.', 'an existing member cannot claim a share invite');

-- ---------------------------------------------------------------------------
-- Profile connect link (D055): no group involved, one connection, single-use, same new-signup scoping.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-0000-0000-0000-000000000003');
select pg_temp.ctx_set('connect1', public.create_connect_invite()::text);
select is((public.preview_share_invite(pg_temp.ctx_jsonb('connect1') ->> 'token') ->> 'kind'), 'connect', 'a connect link previews with no group');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000006');
select throws_ok(format($f$ select public.claim_share_invite('%s') $f$, pg_temp.ctx_jsonb('connect1') ->> 'token'), 'P0001', 'This link is for people new to Callout — ask them to add you by your Callout ID or email instead.', 'connect links carry the same new-signup scoping (D054/D055)');

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-0000-0000-0000-000000000007', 'lia@callout.test', '{"display_name": "Lia"}'::jsonb);

select pg_temp.impersonate('11111111-0000-0000-0000-000000000007');
select is((public.claim_share_invite(pg_temp.ctx_jsonb('connect1') ->> 'token') ->> 'status'), 'connected', 'a new signup claiming a connect link becomes connected (D055)');

reset role;
select ok(pg_temp.connected('11111111-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000003'), 'the connect-link connection exists with no shared group (D055)');
select ok((select si.consumed_at is not null from public.share_invite si where si.id = (pg_temp.ctx_jsonb('connect1') ->> 'share_invite_id')::uuid), 'the connect token was consumed — single-use');

-- ---------------------------------------------------------------------------
-- Join by code (D050/D051): instant pre-start, request-approval once started, reusable by everyone, removed members always need approval.
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
select throws_ok(format($f$ select public.join_group_by_code('%s') $f$, pg_temp.ctx_jsonb('group3_res') ->> 'join_code'), 'P0001', 'You are already a member of this group.', 're-entering the code as a member reports already_member');

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
