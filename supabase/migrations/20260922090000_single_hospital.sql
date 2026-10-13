-- =============================================================================
-- Single hospital.
--
-- The system now serves one hospital. The tables keep their hospital_id scoping,
-- which costs nothing and keeps every row-level rule unchanged, but a hospital can
-- only be created when none exists: a super admin sets it up once, then edits it.
-- =============================================================================

create function private.hospital_exists()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.hospitals);
$$;

grant execute on function private.hospital_exists() to authenticated;

drop policy hospitals_insert on public.hospitals;

create policy hospitals_insert on public.hospitals
  for insert to authenticated
  with check ((select private.is_super_admin()) and not (select private.hospital_exists()));
