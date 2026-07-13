-- Phase 3B — pgTAP verification of the identity & connections surface (run with `supabase test db`).
-- Covers short IDs (D032), exact-match adds with the email enumeration guarantee (D033), removal (D038), connection-only group invites (D035), auto-connect on shared membership with its once-per-pair-per-group ledger (D039), single-use share invites (D036), and the RLS/privilege posture of the new tables.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(61);

-- ---------------------------------------------------------------------------
-- Fixtures and impersonation plumbing (same pattern as rpc_core_loop.sql).
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-0000-0000-0000-000000000001', 'fay@callout.test', '{"display_name": "Fay"}'::jsonb),
  ('11111111-0000-0000-0000-000000000002', 'gus@callout.test', '{"display_name": "Gus"}'::jsonb),
  ('11111111-0000-0000-0000-000000000003', 'hana@callout.test', '{"display_name": "Hana"}'::jsonb),
  ('11111111-0000-0000-0000-000000000004', 'ivan@callout.test', '{"display_name": "Ivan"}'::jsonb),
  ('11111111-0000-0000-0000-000000000005', 'june@callout.test', '{"display_name": "June"}'::jsonb);

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

select is((select count(*)::int from public.profile p where p.id::text like '11111111-%' and p.short_id ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$'), 5, 'every new profile got an 8-character short ID from the lookalike-free alphabet (D032)');
select is((select count(distinct p.short_id)::int from public.profile p where p.id::text like '11111111-%'), 5, 'all short IDs are distinct');

select pg_temp.ctx_set('gus_code', (select p.short_id from public.profile p where p.id = '11111111-0000-0000-0000-000000000002'));
select pg_temp.ctx_set('hana_code', (select p.short_id from public.profile p where p.id = '11111111-0000-0000-0000-000000000003'));
select pg_temp.ctx_set('fay_code', (select p.short_id from public.profile p where p.id = '11111111-0000-0000-0000-000000000001'));

-- ---------------------------------------------------------------------------
-- add_connection_by_short_id (D033): exact match, instant, no accept step; misses reported honestly since IDs are non-enumerable.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');

select throws_ok($$ select public.add_connection_by_short_id('  ') $$, 'P0001', 'Enter a Callout ID.', 'a blank code is rejected');
select throws_ok($$ select public.add_connection_by_short_id('22222222') $$, 'P0001', 'No one was found with that ID. Double-check it and try again.', 'an unknown code reports not found');
select throws_ok(format($f$ select public.add_connection_by_short_id('%s') $f$, (select val from ctx where key = 'fay_code')), 'P0001', 'That is your own ID.', 'adding your own ID is rejected');

select pg_temp.ctx_set('add_gus_res', public.add_connection_by_short_id((select val from ctx where key = 'gus_code'))::text);
select ok((pg_temp.ctx_jsonb('add_gus_res') ->> 'display_name') = 'Gus' and (pg_temp.ctx_jsonb('add_gus_res') ->> 'already_connected')::boolean = false, 'adding by short ID returns the connected profile and completes instantly (D033)');

reset role;
select ok(pg_temp.connected('11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002'), 'the connection row exists, canonicalized to one row per pair');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select ok((public.add_connection_by_short_id((select val from ctx where key = 'gus_code')) ->> 'already_connected')::boolean, 're-adding an existing connection reports already_connected');

reset role;
select is((select count(*)::int from public.connection c where c.user_a_id = '11111111-0000-0000-0000-000000000001' or c.user_b_id = '11111111-0000-0000-0000-000000000001'), 1, 're-adding never duplicates the pair row');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select is((public.add_connection_by_short_id(lower((select val from ctx where key = 'hana_code'))) ->> 'display_name'), 'Hana', 'short ID lookup is case-insensitive');

-- ---------------------------------------------------------------------------
-- add_connection_by_email (D033): the response is identical whether or not the email matches an account — the enumeration guarantee.
-- ---------------------------------------------------------------------------

select is((public.add_connection_by_email('ivan@callout.test') ->> 'status'), 'processed', 'a matching email returns the generic processed response');

reset role;
select ok(pg_temp.connected('11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000004'), 'the matching email silently created the connection');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select is((public.add_connection_by_email('nobody@callout.test') ->> 'status'), 'processed', 'a non-matching email returns the exact same generic response (D033 enumeration guard)');
select throws_ok($$ select public.add_connection_by_email('not-an-email') $$, 'P0001', 'Enter an email address.', 'a malformed email is rejected as input, not looked up');
select is((public.add_connection_by_email('fay@callout.test') ->> 'status'), 'processed', 'adding your own email returns the same generic response');

reset role;
select is((select count(*)::int from public.connection c where c.user_a_id = '11111111-0000-0000-0000-000000000001' or c.user_b_id = '11111111-0000-0000-0000-000000000001'), 3, 'no-match and self-match emails created no connection rows');

-- ---------------------------------------------------------------------------
-- RLS and privilege posture: connections are participant-visible only; profiles open up to connections (D033/D034); nothing new is client-writable, and short_id is not self-updatable.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-0000-0000-0000-000000000002');
select is((select count(*)::int from public.profile p where p.id = '11111111-0000-0000-0000-000000000001'), 1, 'a connected user can read the profile without sharing any group (D033)');
select is((select count(*)::int from public.connection), 1, 'a user sees only connection rows they participate in');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000005');
select is((select count(*)::int from public.profile p where p.id = '11111111-0000-0000-0000-000000000001'), 0, 'an unconnected user with no shared group cannot read the profile');
select is((select count(*)::int from public.connection), 0, 'an unconnected user sees no connection rows at all');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select is((select count(*)::int from public.connection), 3, 'a user sees all of their own connections');
select throws_ok($$ insert into public.connection (user_a_id, user_b_id) values ('11111111-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000005') $$, '42501', null, 'clients cannot insert connection rows directly (CLAUDE.md §2.2)');
select throws_ok($$ insert into public.share_invite (group_id, inviter_user_id) values (gen_random_uuid(), '11111111-0000-0000-0000-000000000001') $$, '42501', null, 'clients cannot insert share_invite rows directly');
select throws_ok($$ update public.profile set short_id = 'AAAAAAAA' where id = '11111111-0000-0000-0000-000000000001' $$, '42501', null, 'short_id is excluded from the self-update column grant (D032)');

set local role anon;
select throws_ok($$ select public.add_connection_by_short_id('22222222') $$, '42501', null, 'anon cannot execute the connection RPCs');
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
-- D035: group invites are connection-only, server-enforced.
-- ---------------------------------------------------------------------------

select throws_ok($$ select public.create_group('Strangers', 60, array['11111111-0000-0000-0000-000000000005']::uuid[]) $$, 'P0001', 'You can only invite people from your connections.', 'create_group rejects a non-connection invitee (D035)');

select pg_temp.ctx_set('group1', (public.create_group('Inner Circle', 60, array['11111111-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000004']::uuid[]) ->> 'group_id'));
select ok(pg_temp.ctx_uuid('group1') is not null, 'create_group accepts connection invitees');
select throws_ok(format($f$ select public.invite_player('%s', '11111111-0000-0000-0000-000000000005') $f$, pg_temp.ctx_uuid('group1')), 'P0001', 'You can only invite people from your connections.', 'invite_player rejects a non-connection target (D035)');

-- ---------------------------------------------------------------------------
-- D039: auto-connect fires when shared membership begins, once per pair per group.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-0000-0000-0000-000000000003');
select lives_ok(format($f$ select public.respond_to_invite('%s', true) $f$, pg_temp.ctx_uuid('group1')), 'Hana accepts her invite');
select pg_temp.impersonate('11111111-0000-0000-0000-000000000004');
select lives_ok(format($f$ select public.respond_to_invite('%s', true) $f$, pg_temp.ctx_uuid('group1')), 'Ivan accepts his invite');

reset role;
select ok(pg_temp.connected('11111111-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000004'), 'co-members were auto-connected with no manual step (D039)');
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
select pg_temp.ctx_set('group2', (public.create_group('Second Circle', 60, array['11111111-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000004']::uuid[]) ->> 'group_id'));
select pg_temp.impersonate('11111111-0000-0000-0000-000000000003');
select lives_ok(format($f$ select public.respond_to_invite('%s', true) $f$, pg_temp.ctx_uuid('group2')), 'Hana accepts into the second group');
select pg_temp.impersonate('11111111-0000-0000-0000-000000000004');
select lives_ok(format($f$ select public.respond_to_invite('%s', true) $f$, pg_temp.ctx_uuid('group2')), 'Ivan accepts into the second group');

reset role;
select ok(pg_temp.connected('11111111-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000004'), 'a later, different shared group auto-connects the same pair again (D038/D039)');

-- ---------------------------------------------------------------------------
-- Share invites (D036): host-only creation, exact-token preview, single-use claim that joins and connects in one action.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-0000-0000-0000-000000000003');
select throws_ok(format($f$ select public.create_share_invite('%s') $f$, pg_temp.ctx_uuid('group1')), 'P0001', 'Only the host can create invite links.', 'a non-host cannot create a share invite');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select pg_temp.ctx_set('invite1', public.create_share_invite(pg_temp.ctx_uuid('group1'))::text);
select ok((pg_temp.ctx_jsonb('invite1') ->> 'token') ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{16}$', 'the share token is a 16-character code from the lookalike-free alphabet (D036)');

select throws_ok($$ select public.preview_share_invite('2222222222222222') $$, 'P0001', 'That invite link is not valid.', 'previewing an unknown token reports not valid');

-- June is a total outsider: no shared group, no connection — the token alone grants the preview.
select pg_temp.impersonate('11111111-0000-0000-0000-000000000005');
select pg_temp.ctx_set('preview1', public.preview_share_invite(pg_temp.ctx_jsonb('invite1') ->> 'token')::text);
select ok((pg_temp.ctx_jsonb('preview1') ->> 'group_name') = 'Inner Circle' and (pg_temp.ctx_jsonb('preview1') ->> 'inviter_name') = 'Fay' and (pg_temp.ctx_jsonb('preview1') ->> 'status') = 'valid', 'preview shows the group, the inviter, and validity by exact token');

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
select throws_ok($$ select public.claim_share_invite('2222222222222222') $$, 'P0001', 'That invite link is not valid.', 'claiming an unknown token reports not valid');

-- An existing member cannot re-claim their way in; a pending invitee claiming flips their invite to active instead of duplicating it.
select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select pg_temp.ctx_set('invite2', public.create_share_invite(pg_temp.ctx_uuid('group1'))::text);
select pg_temp.impersonate('11111111-0000-0000-0000-000000000003');
select throws_ok(format($f$ select public.claim_share_invite('%s') $f$, pg_temp.ctx_jsonb('invite2') ->> 'token'), 'P0001', 'You are already a member of this group.', 'an existing member cannot claim a share invite');

select pg_temp.impersonate('11111111-0000-0000-0000-000000000001');
select lives_ok($$ select public.add_connection_by_short_id((select val from ctx where key = 'gus_code')) $$, 'Fay reconnects with Gus');
select lives_ok(format($f$ select public.invite_player('%s', '11111111-0000-0000-0000-000000000002') $f$, pg_temp.ctx_uuid('group1')), 'the host directly invites Gus');
select pg_temp.impersonate('11111111-0000-0000-0000-000000000002');
select is((public.claim_share_invite(pg_temp.ctx_jsonb('invite2') ->> 'token') ->> 'status'), 'joined', 'a pending invitee can claim a share invite');

reset role;
select ok((select count(*) = 1 from public.membership m where m.group_id = pg_temp.ctx_uuid('group1') and m.user_id = '11111111-0000-0000-0000-000000000002') and (select m.status = 'active' from public.membership m where m.group_id = pg_temp.ctx_uuid('group1') and m.user_id = '11111111-0000-0000-0000-000000000002'), 'the claim flipped the pending invite to active without duplicating the membership');

select * from finish();
rollback;
