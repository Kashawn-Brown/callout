-- Phase 1 — Row Level Security for every user-facing table (CLAUDE.md §2.3).
-- Read rules: non-members see nothing; invited members see the group row and roster only (D025); active and eliminated members see all group content (D012); removed members see nothing but their own membership row; notifications are recipient-only.
-- Write rules: clients NEVER write game-state tables directly (CLAUDE.md §2.2) — there are no write policies at all, and write privileges are revoked outright as defense in depth. All mutations arrive in later phases as SECURITY DEFINER RPCs. The one exception is profile, which is user-owned (not a game-state table) and self-updatable.

-- ---------------------------------------------------------------------------
-- Helper predicates. SECURITY DEFINER is required (CLAUDE.md §6): membership's own select policy consults membership, so an invoker-rights helper would recurse into RLS infinitely. Definer runs as the table owner, which RLS does not apply to. search_path is emptied and every reference schema-qualified.
-- ---------------------------------------------------------------------------

-- True when the current user has one of the given membership statuses in the group.
create function private.has_membership_status(target_group_id uuid, statuses public.membership_status[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membership m
    where m.group_id = target_group_id
      and m.user_id = (select auth.uid())
      and m.status = any (statuses)
  );
$$;

-- Group-row and roster visibility: invited members included so they can evaluate the invite (D025).
create function private.is_group_participant(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_membership_status(target_group_id, array['invited', 'active', 'out_eliminated']::public.membership_status[]);
$$;

-- Gameplay-content visibility: eliminated members retain it (D012); invited and removed members do not (D025).
create function private.can_read_group_content(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_membership_status(target_group_id, array['active', 'out_eliminated']::public.membership_status[]);
$$;

-- Profile visibility: true when the current user shares any group with the target user. The target's own status is deliberately unfiltered so past content (submissions, comments) by since-removed members still renders with a name, preserving group history (D018 spirit).
create function private.shares_group_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membership mine
    join public.membership theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid())
      and mine.status = any (array['invited', 'active', 'out_eliminated']::public.membership_status[])
      and theirs.user_id = target_user_id
  );
$$;

-- Policy expressions run with the querying role's privileges, so API roles need to be able to execute the helpers. The private schema stays out of PostgREST's exposed schemas regardless (supabase/config.toml).
grant usage on schema private to anon, authenticated, service_role;
-- The signup trigger fires under GoTrue's role, which needs to reach its definer function.
grant usage on schema private to supabase_auth_admin;
grant execute on function private.handle_new_user() to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. Default-deny: any table/command without a policy is inaccessible.
-- ---------------------------------------------------------------------------
alter table public.profile enable row level security;
alter table public."group" enable row level security;
alter table public.membership enable row level security;
alter table public.round enable row level security;
alter table public.turn enable row level security;
alter table public.submission enable row level security;
alter table public.volunteer enable row level security;
alter table public.submission_comment enable row level security;
alter table public.notification enable row level security;

-- ---------------------------------------------------------------------------
-- Select policies.
-- ---------------------------------------------------------------------------

create policy profile_select_self_or_groupmate on public.profile
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_group_with(id));

create policy group_select_participant on public."group"
  for select to authenticated
  using (private.is_group_participant(id));

-- Own rows are always visible (pending invites across groups, and a removed member seeing that they were removed); the roster is visible to participants (D025).
create policy membership_select_own_or_roster on public.membership
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_group_participant(group_id));

create policy round_select_content_reader on public.round
  for select to authenticated
  using (private.can_read_group_content(group_id));

create policy turn_select_content_reader on public.turn
  for select to authenticated
  using (private.can_read_group_content(group_id));

-- volunteer has no group_id; the round subquery re-applies round's own policy, which is the same predicate.
create policy volunteer_select_content_reader on public.volunteer
  for select to authenticated
  using (exists (select 1 from public.round r where r.id = volunteer.round_id and private.can_read_group_content(r.group_id)));

create policy submission_select_content_reader on public.submission
  for select to authenticated
  using (exists (select 1 from public.turn t where t.id = submission.turn_id and private.can_read_group_content(t.group_id)));

create policy submission_comment_select_content_reader on public.submission_comment
  for select to authenticated
  using (exists (select 1 from public.submission s join public.turn t on t.id = s.turn_id where s.id = submission_comment.submission_id and private.can_read_group_content(t.group_id)));

create policy notification_select_recipient on public.notification
  for select to authenticated
  using (recipient_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- The single client-write surface: a user may update their own profile (display identity, notification settings per D017). Creation stays with the signup trigger; deletion is Phase 12's anonymizing RPC (D018).
-- ---------------------------------------------------------------------------
create policy profile_update_self on public.profile
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Privilege hardening on top of default-deny RLS. Supabase's default privileges grant ALL on public tables to the API roles; revoking writes makes CLAUDE.md §2.2 hold at the privilege layer too, so a future policy mistake cannot quietly open a write path. Future RPCs are SECURITY DEFINER and unaffected.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public."group", public.membership, public.round, public.turn, public.submission, public.volunteer, public.submission_comment, public.notification from anon, authenticated;
revoke insert, delete on public.profile from anon, authenticated;
-- Nothing in Callout is readable logged-out: groups are invite-only and closed.
revoke all on public.profile, public."group", public.membership, public.round, public.turn, public.submission, public.volunteer, public.submission_comment, public.notification from anon;
