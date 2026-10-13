-- =============================================================================
-- Foundation: extensions, private schema, shared trigger functions, audit log.
-- Design reference: docs/01-database-and-authorization-design.md §1 (D13), §5.16
-- =============================================================================

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- Private schema: helper and trigger functions. Not exposed through the Data API.
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- New functions must be granted explicitly instead of being executable by PUBLIC.
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Append-only guard
-- -----------------------------------------------------------------------------
create function private.prevent_modification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'APPEND_ONLY_TABLE'
    using errcode = '42501',
          hint = format('Rows in %I cannot be updated, deleted or truncated.', tg_table_name);
end;
$$;

-- -----------------------------------------------------------------------------
-- audit_logs
-- hospital_id and actor_id intentionally have no foreign keys: audit rows must
-- never change or disappear because a referenced row changes.
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id            bigint generated always as identity primary key,
  hospital_id   uuid,
  actor_id      uuid,
  actor_role    text,
  action        text not null,
  entity_table  text not null,
  entity_id     text,
  old_data      jsonb,
  new_data      jsonb,
  reason        text,
  context       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index audit_logs_hospital_created_idx on public.audit_logs (hospital_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_table, entity_id, created_at desc);
create index audit_logs_actor_created_idx on public.audit_logs (actor_id, created_at desc);

create trigger audit_logs_prevent_modification
  before update or delete on public.audit_logs
  for each row execute function private.prevent_modification();

create trigger audit_logs_prevent_truncate
  before truncate on public.audit_logs
  for each statement execute function private.prevent_modification();

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon, authenticated, service_role;
grant select on public.audit_logs to authenticated, service_role;
-- The select policy is created with the RLS helper functions (tenancy migration).

-- -----------------------------------------------------------------------------
-- Generic row audit trigger.
-- Callers may set transaction-local context before writing:
--   select set_config('app.audit_reason', 'why', true);
--   select set_config('app.audit_source', 'job', true);
-- -----------------------------------------------------------------------------
create function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old      jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new      jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row      jsonb := coalesce(v_new, v_old);
  v_actor_id uuid  := auth.uid();
  v_headers  jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
begin
  -- Ignore no-op updates, including ones that only touch updated_at.
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;

  insert into public.audit_logs (
    hospital_id, actor_id, actor_role, action, entity_table, entity_id,
    old_data, new_data, reason, context
  )
  values (
    (case when tg_table_name = 'hospitals' then v_row ->> 'id' else v_row ->> 'hospital_id' end)::uuid,
    v_actor_id,
    coalesce(
      (select p.role::text from public.profiles p where p.id = v_actor_id),
      nullif(current_setting('role', true), 'none')
    ),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'hospital_id'),
    v_old,
    v_new,
    nullif(current_setting('app.audit_reason', true), ''),
    jsonb_strip_nulls(jsonb_build_object(
      'source',     nullif(current_setting('app.audit_source', true), ''),
      'ip',         nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''),
      'user_agent', v_headers ->> 'user-agent'
    ))
  );

  return null;
end;
$$;
