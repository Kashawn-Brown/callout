-- Phase 3 — explicit client table privileges.
-- Phase 1 revoked write privileges and relied on the environment's default grants for reads. That held on the local stack, but the hosted project's default privileges differ (tables arrived via db push with no SELECT for the API roles, yet with TRUNCATE/TRIGGER/REFERENCES), which broke every direct read the app makes. The client privilege posture is therefore stated explicitly and identically for both environments: authenticated reads all game tables through RLS and may update only profile (the profile_update_self policy needs the table-level privilege); anon gets nothing (groups are invite-only and closed); nobody client-side holds insert/delete/truncate/trigger/references on anything (CLAUDE.md §2.2 — mutations are SECURITY DEFINER RPCs).

revoke all on public.profile, public."group", public.membership, public.round, public.turn, public.submission, public.volunteer, public.submission_comment, public.notification from anon, authenticated;

grant select on public.profile, public."group", public.membership, public.round, public.turn, public.submission, public.volunteer, public.submission_comment, public.notification to authenticated;

-- The single client-write surface from Phase 1: self-service profile updates (display identity, D017 notification settings), still row-filtered by profile_update_self.
grant update on public.profile to authenticated;
