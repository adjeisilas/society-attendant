-- Minimal stand-in for the Supabase platform objects the migrations depend on.
-- Mirrors Supabase behaviour for testing: API roles, auth schema helpers and the
-- default privileges Supabase grants on the public schema (which migrations must
-- explicitly revoke).

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id                  uuid primary key,
  email               text,
  raw_app_meta_data   jsonb,
  raw_user_meta_data  jsonb,
  email_confirmed_at  timestamptz,
  created_at          timestamptz not null default now()
);

create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
