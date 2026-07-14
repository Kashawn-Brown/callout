-- Phase 3B simplification pass (D059–D066): group sharing consolidates onto the persistent join code and email stops being a lookup key.
-- The single-use share-invite token system (group tokens AND profile connect links) is retired outright (D063/D066) — the join code already covers bringing anyone into a group, and the profile share becomes a plain app-download link with no backend at all. Search narrows to exact Callout ID only (D060), performed as a deliberate action rather than as-you-type (D061, a client behavior). Already-a-member code entry becomes an informational outcome instead of an error (D065).

-- ---------------------------------------------------------------------------
-- Retire the token system. The table goes too, not just the RPCs: nothing else references share_invite, its rows are all consumed test tokens, and leaving a dead client-readable table contradicts the schema being the documentation of record.
-- ---------------------------------------------------------------------------

drop function public.create_share_invite(uuid);
drop function public.preview_share_invite(text);
drop function public.claim_share_invite(text);
drop function public.create_connect_invite();
drop table public.share_invite;

-- ---------------------------------------------------------------------------
-- Search narrows to the exact Callout ID (D060): email is no longer a lookup key anywhere, and connections-by-name filtering moved fully client-side over the already-loaded connections list (D034/D059) — so the combined search RPC gives way to a single exact-ID finder.
-- ---------------------------------------------------------------------------

drop function public.search_users(text);

create function public.find_user_by_short_id(short_id_code text)
returns table (user_id uuid, display_name text, avatar_url text, short_id text, is_connection boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_code text;
begin
  v_uid := private.assert_authenticated();
  v_code := upper(btrim(coalesce(short_id_code, '')));

  if v_code = '' then
    perform private.raise_app_error('invalid_input', 'Enter a Callout ID.');
  end if;

  -- Zero or one row: the ID either matches exactly or it doesn't. IDs are high-entropy (D032), so a miss leaks nothing, and the deliberate-search UX (D061) plus auth rate limits bound probing.
  return query
  select p.id, p.display_name, p.avatar_url, p.short_id, private.are_connected(v_uid, p.id)
  from public.profile p
  where p.id <> v_uid
    and p.short_id = v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- D065: entering the code for a group you're already an active member of is information, not failure — the client routes to the group with a plain message. Everything else about join_group_by_code is unchanged from the D051 build.
-- ---------------------------------------------------------------------------

create or replace function public.join_group_by_code(code text)
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

  -- Already in: an informational outcome the client turns into "open the group" (D065), not an error.
  if v_has_membership and v_membership.status in ('active', 'out_eliminated') then
    return jsonb_build_object('status', 'already_member', 'group_id', v_group.id, 'group_name', v_group.name);
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

  -- Removed members always go through host approval, whatever the group status: the host removed them, so silent code re-entry would undo a host decision (reaffirmed by D063).
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

-- ---------------------------------------------------------------------------
-- Function privileges, per the standing convention.
-- ---------------------------------------------------------------------------

revoke execute on function public.find_user_by_short_id(text) from public, anon;
grant execute on function public.find_user_by_short_id(text) to authenticated;
