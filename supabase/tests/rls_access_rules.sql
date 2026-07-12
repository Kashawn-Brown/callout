-- Phase 1 — pgTAP verification of the access rules (run with `supabase test db`).
-- Proves plan.md Phase 1's done-when: the schema exists and a non-member genuinely cannot read a group's data — plus the D012/D025 visibility tiers, the RPC-only write posture (CLAUDE.md §2.2), and the signup trigger.
-- Everything runs in one rolled-back transaction; fixtures are inserted as postgres (bypasses RLS), then each persona is impersonated via SET ROLE + request.jwt.claims, exactly how PostgREST executes queries.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(53);

-- ---------------------------------------------------------------------------
-- Fixtures: six users covering every visibility tier, one group, one round, one completed turn with submission, comment, volunteer, and two notifications.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'host@callout.test', '{"display_name": "The Host"}'::jsonb),
  ('00000000-0000-0000-0000-000000000002', 'member@callout.test', null),
  ('00000000-0000-0000-0000-000000000003', 'eliminated@callout.test', null),
  ('00000000-0000-0000-0000-000000000004', 'removed@callout.test', null),
  ('00000000-0000-0000-0000-000000000005', 'invited@callout.test', null),
  ('00000000-0000-0000-0000-000000000006', 'outsider@callout.test', null);

insert into public."group" (id, name, host_id, per_turn_deadline) values
  ('11111111-1111-1111-1111-111111111111', 'Test Group', '00000000-0000-0000-0000-000000000001', interval '1 hour');

insert into public.membership (group_id, user_id, role, status, joined_at) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'host', 'active', now()),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', 'player', 'active', now()),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000003', 'player', 'out_eliminated', now()),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000004', 'player', 'removed', now()),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000005', 'player', 'invited', null);

insert into public.round (id, group_id, round_number, status) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 1, 'in_progress');

insert into public.turn (id, round_id, group_id, called_out_user_id, called_by_user_id, deadline_at, status) values
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', now() + interval '1 hour', 'submitted');

insert into public.submission (id, turn_id, type, text_content) values
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'text', 'Done: 20 pushups');

insert into public.submission_comment (id, submission_id, sender_user_id, content) values
  ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000001', 'nice one');

insert into public.volunteer (id, round_id, user_id) values
  ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000002');

insert into public.notification (group_id, turn_id, recipient_user_id, sent_by, type) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'called_out'),
  ('11111111-1111-1111-1111-111111111111', null, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'group_invited');

-- ---------------------------------------------------------------------------
-- Signup trigger (as postgres): profiles were auto-created with the right display names.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.profile), 6, 'signup trigger created a profile for every auth user');
select is((select display_name from public.profile where id = '00000000-0000-0000-0000-000000000001'), 'The Host', 'display_name comes from raw_user_meta_data when present');
select is((select display_name from public.profile where id = '00000000-0000-0000-0000-000000000002'), 'member', 'display_name falls back to the email prefix');

-- ---------------------------------------------------------------------------
-- Outsider (no membership at all): sees nothing of the group, anywhere. This is Phase 1's done-when check.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000006", "role": "authenticated"}', true);

select is((select count(*)::int from public."group"), 0, 'outsider cannot read the group row');
select is((select count(*)::int from public.membership), 0, 'outsider cannot read the roster');
select is((select count(*)::int from public.round), 0, 'outsider cannot read rounds');
select is((select count(*)::int from public.turn), 0, 'outsider cannot read turns');
select is((select count(*)::int from public.submission), 0, 'outsider cannot read submissions');
select is((select count(*)::int from public.submission_comment), 0, 'outsider cannot read comments');
select is((select count(*)::int from public.volunteer), 0, 'outsider cannot read volunteers');
select is((select count(*)::int from public.notification), 0, 'outsider cannot read notifications');
select is((select count(*)::int from public.profile where id <> '00000000-0000-0000-0000-000000000006'), 0, 'outsider cannot read profiles of people they share no group with');
select is((select count(*)::int from public.profile where id = '00000000-0000-0000-0000-000000000006'), 1, 'outsider can read their own profile');

reset role;

-- ---------------------------------------------------------------------------
-- Active member: full read visibility, zero direct write ability (CLAUDE.md §2.2), self-service profile updates.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}', true);

select is((select count(*)::int from public."group"), 1, 'active member reads the group row');
select is((select count(*)::int from public.membership), 5, 'active member reads the full roster including invited and removed rows');
select is((select count(*)::int from public.round), 1, 'active member reads rounds');
select is((select count(*)::int from public.turn), 1, 'active member reads turns');
select is((select count(*)::int from public.submission), 1, 'active member reads submissions');
select is((select count(*)::int from public.submission_comment), 1, 'active member reads comments');
select is((select count(*)::int from public.volunteer), 1, 'active member reads volunteers');
select is((select count(*)::int from public.notification where type = 'called_out'), 1, 'active member reads their own notification');
select is((select count(*)::int from public.profile where id = '00000000-0000-0000-0000-000000000001'), 1, 'active member reads a groupmate profile');

select throws_ok($$ insert into public.round (group_id, round_number) values ('11111111-1111-1111-1111-111111111111', 2) $$, '42501', null, 'member cannot insert a round directly');
select throws_ok($$ update public."group" set name = 'hijacked' $$, '42501', null, 'member cannot update the group directly');
select throws_ok($$ insert into public.turn (round_id, group_id, called_out_user_id, deadline_at) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000003', now()) $$, '42501', null, 'member cannot insert a turn directly');
select throws_ok($$ update public.turn set status = 'skipped' $$, '42501', null, 'member cannot update a turn directly');
select throws_ok($$ insert into public.submission (turn_id, type, text_content) values ('33333333-3333-3333-3333-333333333333', 'text', 'forged') $$, '42501', null, 'member cannot insert a submission directly');
select throws_ok($$ insert into public.volunteer (round_id, user_id) values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000003') $$, '42501', null, 'member cannot insert a volunteer directly');
select throws_ok($$ insert into public.submission_comment (submission_id, sender_user_id, content) values ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000002', 'hi') $$, '42501', null, 'member cannot insert a comment directly');
select throws_ok($$ insert into public.notification (group_id, recipient_user_id, type) values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', 'nudge') $$, '42501', null, 'member cannot insert a notification directly');
select throws_ok($$ delete from public.membership where user_id = '00000000-0000-0000-0000-000000000004' $$, '42501', null, 'member cannot delete memberships directly');

select lives_ok($$ update public.profile set display_name = 'Renamed', notify_called_out = false where id = '00000000-0000-0000-0000-000000000002' $$, 'member can update their own profile');
select is((select display_name from public.profile where id = '00000000-0000-0000-0000-000000000002'), 'Renamed', 'own-profile update took effect');
select lives_ok($$ update public.profile set display_name = 'hacked' where id = '00000000-0000-0000-0000-000000000001' $$, 'updating someone else''s profile is silently filtered to zero rows by RLS');

reset role;

select is((select display_name from public.profile where id = '00000000-0000-0000-0000-000000000001'), 'The Host', 'the other profile was untouched');
select is((select notify_called_out from public.profile where id = '00000000-0000-0000-0000-000000000002'), false, 'notification-setting update persisted');

-- ---------------------------------------------------------------------------
-- Eliminated member: retains full read visibility (D012).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000003", "role": "authenticated"}', true);

select is((select count(*)::int from public."group"), 1, 'eliminated member still reads the group row');
select is((select count(*)::int from public.round), 1, 'eliminated member still reads rounds');
select is((select count(*)::int from public.turn), 1, 'eliminated member still reads turns');
select is((select count(*)::int from public.submission), 1, 'eliminated member still reads submissions');

reset role;

-- ---------------------------------------------------------------------------
-- Removed member: no group visibility, but can still see their own membership row (D025).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000004", "role": "authenticated"}', true);

select is((select count(*)::int from public."group"), 0, 'removed member cannot read the group row');
select is((select count(*)::int from public.round), 0, 'removed member cannot read rounds');
select is((select count(*)::int from public.turn), 0, 'removed member cannot read turns');
select is((select count(*)::int from public.submission), 0, 'removed member cannot read submissions');
select is((select status from public.membership where user_id = '00000000-0000-0000-0000-000000000004'), 'removed'::public.membership_status, 'removed member can still see their own membership row');

reset role;

-- ---------------------------------------------------------------------------
-- Invited member: group row and roster only, no gameplay content (D025); their invite notification is readable.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000005", "role": "authenticated"}', true);

select is((select count(*)::int from public."group"), 1, 'invited member reads the group row to evaluate the invite');
select is((select count(*)::int from public.membership), 5, 'invited member reads the roster');
select is((select count(*)::int from public.round), 0, 'invited member cannot read rounds');
select is((select count(*)::int from public.turn), 0, 'invited member cannot read turns');
select is((select count(*)::int from public.submission), 0, 'invited member cannot read submissions');
select is((select count(*)::int from public.volunteer), 0, 'invited member cannot read volunteers');
select is((select count(*)::int from public.notification where type = 'group_invited'), 1, 'invited member reads their invite notification');

reset role;

-- ---------------------------------------------------------------------------
-- Anon: no access at all — privileges are revoked outright, not just policy-filtered.
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select count(*) from public."group" $$, '42501', null, 'anon cannot even select from group');
reset role;

select * from finish();
rollback;
