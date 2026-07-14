-- Phase 3B — user-selectable avatar color. Null means "no preference": clients keep deriving the color from the user id hash exactly as before, so nobody's avatar changes until they pick. The palette is fixed server-side to the six prototype member colors plus gold and lime — tuned for the dark theme's contrast — and the column joins display_name in the sanctioned self-update surface (CLAUDE.md §2.2's one exception).

alter table public.profile add column avatar_color text
  check (avatar_color in ('#7B61FF', '#00D4AA', '#FF9A2E', '#FF4E3A', '#FF6B9D', '#4ECAFF', '#FFD166', '#A3E635'));

comment on column public.profile.avatar_color is 'User-picked avatar accent from the fixed palette; null falls back to the deterministic per-user hash color. Self-updatable like display_name.';

-- Column-level grants are additive: this extends the existing explicit column list without restating it.
grant update (avatar_color) on public.profile to authenticated;

-- Recreate the exact-ID lookup with the color included, so pickers render a found stranger with their chosen accent instead of only the hash fallback.
drop function public.find_user_by_short_id(text);

create function public.find_user_by_short_id(short_id_code text)
returns table (user_id uuid, display_name text, avatar_url text, short_id text, avatar_color text, is_connection boolean)
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
  select p.id, p.display_name, p.avatar_url, p.short_id, p.avatar_color, private.are_connected(v_uid, p.id)
  from public.profile p
  where p.id <> v_uid
    and p.short_id = v_code;
end;
$$;

revoke execute on function public.find_user_by_short_id(text) from public, anon;
grant execute on function public.find_user_by_short_id(text) to authenticated;
