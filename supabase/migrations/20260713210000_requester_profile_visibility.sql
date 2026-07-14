-- Phase 3B correction pass, follow-up: a join requester (D051) shares no group and usually no connection with the group's members, so under the existing profile policy the host's approval UI could not render the requester's name. Profiles open up to users with a pending join request to a group the reader participates in — exactly while the request is pending, since approve/decline both delete the row (and approval makes them a groupmate anyway).

-- Same SECURITY DEFINER rationale as the Phase 1 policy helpers: runs inside a policy with the querying role's privileges and must not recurse into RLS.
create function private.has_pending_request_to_my_group(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.join_request jr
    join public.membership m on m.group_id = jr.group_id
    where jr.user_id = target_user_id
      and m.user_id = (select auth.uid())
      and m.status = any (array['active', 'out_eliminated']::public.membership_status[])
  );
$$;

drop policy profile_select_self_groupmate_or_connection on public.profile;
create policy profile_select_self_groupmate_connection_or_requester on public.profile
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.shares_group_with(id)
    or private.is_connected_with(id)
    or private.has_pending_request_to_my_group(id)
  );

grant execute on function private.has_pending_request_to_my_group(uuid) to authenticated;
