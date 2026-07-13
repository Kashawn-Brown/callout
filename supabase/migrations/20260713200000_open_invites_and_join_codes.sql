-- Phase 3B correction pass — open invites and join codes (D047–D057, superseding D035/D045/D046).
-- The core correction: group invites are NOT connection-gated. Connections are a convenience layer (name search, D034), never a gate — exact ID/email search reaches the whole user base (D047). Around that land the persistent group join code (D050) with its pre-start instant join and post-start request-approval flow (D051), share-link modes (D052/D054), and the profile-level connect link (D055).

-- ---------------------------------------------------------------------------
-- group.join_code (D050): persistent, human-typeable, assigned at creation, never expires or regenerates for MVP. Same lookalike-free format as a user's Callout ID, deliberately — the two are described as parallel.
-- ---------------------------------------------------------------------------

create function private.unique_join_code()
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
    exit when not exists (select 1 from public."group" g where g.join_code = v_candidate);
  end loop;
  return v_candidate;
end;
$$;

alter table public."group" add column join_code text;
update public."group" set join_code = private.unique_join_code() where join_code is null;
alter table public."group" alter column join_code set not null;
alter table public."group" alter column join_code set default private.unique_join_code();
alter table public."group" add constraint group_join_code_unique unique (join_code);
alter table public."group" add constraint group_join_code_format check (join_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$');

comment on column public."group".join_code is 'Persistent group join code (D050): admits people directly while the group is in setup, creates a host-approved join request once started (D051), and doubles as the open share-link payload (D052). Never expires or regenerates in MVP.';

-- ---------------------------------------------------------------------------
-- join_request (D051): a pending code-entry join awaiting host action on an already-started group. Deliberately a separate table rather than a membership status: requests are ephemeral (deleted on approve/decline), which keeps every existing membership query — fairness pools, rosters, cap counts — structurally unable to see them.
-- ---------------------------------------------------------------------------

create table public.join_request (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public."group" (id) on delete cascade,
  user_id uuid not null references public.profile (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);

comment on table public.join_request is 'Pending join-by-code request (D051), created when someone enters an active group''s code. Host approval creates the membership and deletes the row; decline just deletes it. Requests never block the code for anyone else.';

alter table public.join_request enable row level security;

-- The requester tracks their own request; the group's participants (host acts, members see) read the group's queue.
create policy join_request_select_own_or_group on public.join_request
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_group_participant(group_id));

revoke all on public.join_request from anon, authenticated;
grant select on public.join_request to authenticated;

alter publication supabase_realtime add table public.join_request;

-- ---------------------------------------------------------------------------
-- share_invite grows a second mode (D055): a null group_id means a profile-level connect link — same single-use token machinery, no destination group, connecting claimant and inviter without any shared membership.
-- ---------------------------------------------------------------------------

alter table public.share_invite alter column group_id drop not null;

comment on table public.share_invite is 'Single-use share tokens. With a group_id: a personal group invite (D036/D052 single-person mode), scoped to new signups only (D054). With group_id null: a profile-level mutual connect link (D055), the one case where a connection forms without shared group membership.';

-- ---------------------------------------------------------------------------
-- Search (D047/D056): one RPC serving both the add-people screen and the connections-tab add. Typing a name searches only the caller''s connections (D034); a full exact Callout ID or exact email matches against the entire user base and surfaces that one profile. Exact matches deliberately reveal that the account exists — that is what "surfaces the matching profile; tapping adds them" requires — which narrows D033''s old generic-response behavior to the blind-add flow it belonged to (now retired by D056); no partial or fuzzy matching ever touches the global user base, and phone numbers are never searchable (D037).
-- ---------------------------------------------------------------------------

create function public.search_users(search_query text)
returns table (user_id uuid, display_name text, avatar_url text, short_id text, is_connection boolean, exact_match boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_raw text;
  v_code text;
  v_email text;
begin
  v_uid := private.assert_authenticated();
  v_raw := btrim(coalesce(search_query, ''));

  if char_length(v_raw) < 2 then
    perform private.raise_app_error('query_too_short', 'Type at least 2 characters to search.');
  end if;

  v_code := upper(v_raw);
  v_email := lower(v_raw);

  return query
  -- Global exact match on short ID or email (D047): at most one row each, no enumeration surface beyond the exact value the caller already knows.
  select p.id, p.display_name, p.avatar_url, p.short_id, private.are_connected(v_uid, p.id), true
  from public.profile p
  left join auth.users u on u.id = p.id
  where p.id <> v_uid
    and (p.short_id = v_code or lower(u.email) = v_email)
  union
  -- Name search scoped strictly to the caller's own connections (D034).
  select p.id, p.display_name, p.avatar_url, p.short_id, true, false
  from public.connection c
  join public.profile p on p.id = case when c.user_a_id = v_uid then c.user_b_id else c.user_a_id end
  where (c.user_a_id = v_uid or c.user_b_id = v_uid)
    and p.display_name ilike '%' || replace(replace(replace(v_raw, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by 6 desc, 2 asc
  limit 20;
end;
$$;

-- ---------------------------------------------------------------------------
-- Connection add becomes search-then-select (D056): the client finds the profile via search_users and adds by user id. The blind add-by-value RPCs are retired with the flow they served.
-- ---------------------------------------------------------------------------

drop function public.add_connection_by_short_id(text);
drop function public.add_connection_by_email(text);

create function public.add_connection(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_target public.profile;
  v_already boolean;
begin
  v_uid := private.assert_authenticated();

  if target_user_id = v_uid then
    perform private.raise_app_error('invalid_input', 'You cannot connect with yourself.');
  end if;

  select * into v_target from public.profile p where p.id = target_user_id;
  if not found then
    perform private.raise_app_error('user_not_found', 'That user does not exist.');
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

-- ---------------------------------------------------------------------------
-- D047: invites are not connection-gated. create_group also sheds its invitee list — creation is step one of the three-step flow (D049); people are added afterwards via invite_player against D047's search.
-- ---------------------------------------------------------------------------

drop function public.create_group(text, integer, uuid[]);

create function public.create_group(group_name text, deadline_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_name text;
  v_group public."group";
begin
  v_uid := private.assert_authenticated();
  v_name := btrim(coalesce(group_name, ''));

  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    perform private.raise_app_error('invalid_input', 'Group name must be between 1 and 80 characters.');
  end if;

  if deadline_minutes is null or deadline_minutes < 5 or deadline_minutes > 10080 then
    perform private.raise_app_error('invalid_input', 'Response deadline must be between 5 minutes and 7 days.');
  end if;

  insert into public."group" (name, host_id, per_turn_deadline)
  values (v_name, v_uid, make_interval(mins => deadline_minutes))
  returning * into v_group;

  insert into public.membership (group_id, user_id, role, status, joined_at)
  values (v_group.id, v_uid, 'host', 'active', now());

  return jsonb_build_object('group_id', v_group.id, 'join_code', v_group.join_code);
end;
$$;

-- Same body as Phase 3's invite_player, with the D045 connection gate removed (D047): the host reaches anyone their search surfaced.
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

  -- A direct invite also clears any pending join request from the same person — the invite supersedes it.
  delete from public.join_request jr where jr.group_id = v_group.id and jr.user_id = target_user_id;

  insert into public.notification (group_id, recipient_user_id, sent_by, type)
  values (v_group.id, target_user_id, v_uid, 'group_invited');

  return jsonb_build_object('membership_id', v_membership_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Join by code (D051): instant while the group is in setup, a host-approved request once it has started. The code is reusable — nothing here ever consumes it.
-- ---------------------------------------------------------------------------

create function public.join_group_by_code(code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group_id uuid;
  v_group public."group";
  v_membership public.membership;
  v_has_membership boolean;
  v_member_count integer;
  v_result jsonb;
begin
  v_uid := private.assert_authenticated();

  select g.id into v_group_id from public."group" g where g.join_code = upper(btrim(coalesce(code, '')));
  if not found then
    perform private.raise_app_error('invalid_code', 'No group was found with that code. Double-check it and try again.');
  end if;

  v_group := private.lock_group(v_group_id);

  if v_group.status = 'ended' then
    perform private.raise_app_error('group_ended', 'This group has ended.');
  end if;

  select * into v_membership from public.membership m
  where m.group_id = v_group.id and m.user_id = v_uid;
  v_has_membership := found;

  if v_has_membership and v_membership.status in ('active', 'out_eliminated') then
    perform private.raise_app_error('already_member', 'You are already a member of this group.');
  end if;

  -- A pending invite plus the code is just acceptance: the host already approved this person by inviting them.
  if v_has_membership and v_membership.status = 'invited' then
    update public.membership set status = 'active', joined_at = now() where id = v_membership.id;

    insert into public.notification (group_id, recipient_user_id, sent_by, type)
    select v_group.id, m.user_id, v_uid, 'member_joined'
    from public.membership m
    where m.group_id = v_group.id and m.status = 'active' and m.user_id <> v_uid;

    v_result := jsonb_build_object('status', 'joined', 'group_id', v_group.id, 'group_name', v_group.name);
    if v_group.status = 'paused' then
      v_result := v_result || private.open_round(v_group);
    end if;
    return v_result;
  end if;

  select count(*) into v_member_count
  from public.membership m
  where m.group_id = v_group.id and m.status in ('invited', 'active', 'out_eliminated');

  if v_member_count + 1 > v_group.max_members then
    perform private.raise_app_error('group_full', 'This group is full.');
  end if;

  -- Removed members always go through host approval, whatever the group status: the host removed them, so silent code re-entry would undo a host decision.
  if v_group.status = 'setup' and not v_has_membership then
    insert into public.membership (group_id, user_id, role, status, joined_at)
    values (v_group.id, v_uid, 'player', 'active', now());

    insert into public.notification (group_id, recipient_user_id, sent_by, type)
    select v_group.id, m.user_id, v_uid, 'member_joined'
    from public.membership m
    where m.group_id = v_group.id and m.status = 'active' and m.user_id <> v_uid;

    return jsonb_build_object('status', 'joined', 'group_id', v_group.id, 'group_name', v_group.name);
  end if;

  -- Started group (active or paused), or a removed member at any stage: a pending request. Idempotent — re-entering the code while one is pending changes nothing (CLAUDE.md §2.7).
  insert into public.join_request (group_id, user_id)
  values (v_group.id, v_uid)
  on conflict (group_id, user_id) do nothing;

  return jsonb_build_object('status', 'request_pending', 'group_id', v_group.id, 'group_name', v_group.name);
end;
$$;

-- Host approval/decline for a pending join request (D051). Approval creates the active membership (or reactivates a removed one) and can resume a paused game; decline just clears the request — the person can request again with the same code.
create function public.respond_join_request(target_group_id uuid, target_user_id uuid, approve boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group public."group";
  v_request public.join_request;
  v_membership public.membership;
  v_member_count integer;
  v_result jsonb;
begin
  v_uid := private.assert_authenticated();
  v_group := private.lock_group(target_group_id);

  if v_group.host_id <> v_uid then
    perform private.raise_app_error('not_host', 'Only the host can respond to join requests.');
  end if;

  select * into v_request from public.join_request jr
  where jr.group_id = v_group.id and jr.user_id = target_user_id;
  if not found then
    perform private.raise_app_error('request_not_found', 'No pending join request from that user.');
  end if;

  delete from public.join_request where id = v_request.id;

  if not approve then
    return jsonb_build_object('status', 'declined');
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
    -- Only a removed row can exist here: active/eliminated members cannot request, and a direct invite deletes the request.
    update public.membership
    set status = 'active', role = 'player', joined_at = now()
    where id = v_membership.id;
  else
    insert into public.membership (group_id, user_id, role, status, joined_at)
    values (v_group.id, target_user_id, 'player', 'active', now());
  end if;

  insert into public.notification (group_id, recipient_user_id, sent_by, type)
  select v_group.id, m.user_id, target_user_id, 'member_joined'
  from public.membership m
  where m.group_id = v_group.id and m.status = 'active' and m.user_id <> target_user_id;

  v_result := jsonb_build_object('status', 'approved');
  if v_group.status = 'paused' then
    v_result := v_result || private.open_round(v_group);
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Share-invite rework (D054/D055): personal tokens are for new signups only — an existing user re-entering a group goes through the join code — and a token with no group is a profile connect link.
-- ---------------------------------------------------------------------------

create function public.create_connect_invite()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_invite public.share_invite;
begin
  v_uid := private.assert_authenticated();

  insert into public.share_invite (group_id, inviter_user_id)
  values (null, v_uid)
  returning * into v_invite;

  return jsonb_build_object('share_invite_id', v_invite.id, 'token', v_invite.token);
end;
$$;

create or replace function public.preview_share_invite(invite_token text)
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

  select p.display_name into v_inviter_name from public.profile p where p.id = v_invite.inviter_user_id;

  if v_invite.group_id is null then
    return jsonb_build_object(
      'kind', 'connect',
      'inviter_name', v_inviter_name,
      'status', case when v_invite.consumed_at is null then 'valid' else 'used' end
    );
  end if;

  select * into v_group from public."group" g where g.id = v_invite.group_id;
  select count(*) into v_member_count
  from public.membership m
  where m.group_id = v_group.id and m.status in ('active', 'out_eliminated');

  return jsonb_build_object(
    'kind', 'group',
    'group_id', v_group.id,
    'group_name', v_group.name,
    'inviter_name', v_inviter_name,
    'member_count', v_member_count,
    'status', case when v_invite.consumed_at is null and v_group.status <> 'ended' then 'valid' else 'used' end
  );
end;
$$;

create or replace function public.claim_share_invite(invite_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_created timestamptz;
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

  -- Connect links (D055) have no group to lock; the token row's single consumption is the only race, settled by the conditional update below.
  if v_invite.group_id is not null then
    v_group := private.lock_group(v_invite.group_id);
    -- Re-read under the group lock: two claimants racing the same token serialize here.
    select * into v_invite from public.share_invite si where si.id = v_invite.id;
  end if;

  if v_invite.consumed_at is not null then
    if v_invite.consumed_by_user_id = v_uid then
      -- The claimant retrying their own successful claim is a no-op, not an error (CLAUDE.md §2.7).
      return jsonb_build_object(
        'status', case when v_invite.group_id is null then 'connected' else 'joined' end,
        'group_id', v_invite.group_id
      );
    end if;
    perform private.raise_app_error('share_invite_used', 'That invite link has already been used.');
  end if;

  -- D054: share links bring new people into the app. An account that predates the link isn't its audience — group links point them at the join code, connect links at an ID/email add.
  select u.created_at into v_created from auth.users u where u.id = v_uid;
  if v_created < v_invite.created_at then
    if v_invite.group_id is null then
      perform private.raise_app_error('not_new_user', 'This link is for people new to Callout — ask them to add you by your Callout ID or email instead.');
    end if;
    perform private.raise_app_error('not_new_user', 'This link is for people new to Callout — ask for the group code and use Join Group instead.');
  end if;

  if v_invite.group_id is null then
    update public.share_invite
    set consumed_at = now(), consumed_by_user_id = v_uid
    where id = v_invite.id and consumed_at is null;
    if not found then
      perform private.raise_app_error('share_invite_used', 'That invite link has already been used.');
    end if;

    if v_invite.inviter_user_id = v_uid then
      perform private.raise_app_error('invalid_input', 'You cannot connect with yourself.');
    end if;
    perform private.connect_users(v_uid, v_invite.inviter_user_id);
    return jsonb_build_object('status', 'connected');
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

  if (not v_has_membership or v_membership.status <> 'invited') and v_member_count + 1 > v_group.max_members then
    perform private.raise_app_error('group_full', 'This group is full.');
  end if;

  update public.share_invite
  set consumed_at = now(), consumed_by_user_id = v_uid
  where id = v_invite.id;

  if v_has_membership then
    -- A new signup can only hold an invited row here (invited by id after signing up, then claiming): the claim doubles as acceptance.
    update public.membership
    set status = 'active', role = 'player', joined_at = now()
    where id = v_membership.id;
  else
    insert into public.membership (group_id, user_id, role, status, joined_at)
    values (v_group.id, v_uid, 'player', 'active', now());
  end if;

  -- The activation trigger connects the claimant with current co-members (D039/D048); this explicit call guarantees the inviter connection unconditionally (D036).
  perform private.connect_users(v_uid, v_invite.inviter_user_id);

  insert into public.notification (group_id, recipient_user_id, sent_by, type)
  select v_group.id, m.user_id, v_uid, 'member_joined'
  from public.membership m
  where m.group_id = v_group.id and m.status = 'active' and m.user_id <> v_uid;

  v_result := jsonb_build_object('status', 'joined', 'group_id', v_group.id);
  if v_group.status = 'paused' then
    v_result := v_result || private.open_round(v_group);
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges, per the standing convention.
-- ---------------------------------------------------------------------------

revoke execute on function public.search_users(text) from public, anon;
revoke execute on function public.add_connection(uuid) from public, anon;
revoke execute on function public.create_group(text, integer) from public, anon;
revoke execute on function public.join_group_by_code(text) from public, anon;
revoke execute on function public.respond_join_request(uuid, uuid, boolean) from public, anon;
revoke execute on function public.create_connect_invite() from public, anon;

grant execute on function public.search_users(text) to authenticated;
grant execute on function public.add_connection(uuid) to authenticated;
grant execute on function public.create_group(text, integer) to authenticated;
grant execute on function public.join_group_by_code(text) to authenticated;
grant execute on function public.respond_join_request(uuid, uuid, boolean) to authenticated;
grant execute on function public.create_connect_invite() to authenticated;

revoke execute on function private.unique_join_code() from public, anon, authenticated;
