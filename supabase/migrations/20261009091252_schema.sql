-- The first schema. Every row belongs to an organization, and the only thing
-- deciding who can read it is the policy at the bottom of this file.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Row-level security is on by default rather than per table. A table that
-- someone forgets to secure would return every organization's rows silently;
-- this makes that impossible instead of unlikely. It runs before the tables
-- below are created, so they get RLS from it, not from a line each.
create or replace function private.enable_rls_on_new_table()
returns event_trigger
language plpgsql
as $$
declare
  obj record;
begin
  for obj in
    select object_identity
    from pg_event_trigger_ddl_commands()
    where object_type = 'table' and schema_name = 'public'
  loop
    execute format('alter table %s enable row level security', obj.object_identity);
  end loop;
end;
$$;

create event trigger enable_rls_on_new_table
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function private.enable_rls_on_new_table();

-- The organization comes off the Clerk session token. Clerk's v2 tokens nest it
-- under "o", v1 tokens put it at the top level; reading both means a token
-- version change can't silently empty every query.
create or replace function private.current_org_id()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id');
$$;

grant usage on schema private to authenticated;
grant execute on function private.current_org_id() to authenticated;

-- Organizations live in Clerk. This table mirrors their ids so every other
-- table can hold a real foreign key, and deleting the organization here
-- cascades through everything it owns.
create table public.organizations (
  id text primary key check (id like 'org\_%'),
  name text not null,
  created_at timestamptz not null default now()
);

-- Child tables carry org_id themselves, so each policy is one comparison with
-- no joins. The composite foreign keys stop a child from claiming a different
-- organization (or analysis) than its parent.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  repo_owner text not null,
  repo_name text not null,
  created_at timestamptz not null default now(),
  -- A repository is mapped once per organization; everyone after starts from it.
  unique (org_id, repo_owner, repo_name),
  unique (id, org_id)
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'failed')),
  commit_sha text,
  -- A failed analysis always says why, and only a failed one has a reason.
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((status = 'failed') = (error is not null)),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade,
  unique (id, org_id)
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  path text not null,
  foreign key (analysis_id, org_id) references public.analyses (id, org_id) on delete cascade,
  unique (analysis_id, path),
  unique (id, analysis_id, org_id)
);

-- Both ends must be files in the same analysis. An edge exists because the
-- parser resolved an import to a real file, so both ends are required.
create table public.edges (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  source_file_id uuid not null,
  target_file_id uuid not null,
  kind text not null check (kind in ('import', 're-export', 'dynamic-import', 'require')),
  foreign key (analysis_id, org_id) references public.analyses (id, org_id) on delete cascade,
  foreign key (source_file_id, analysis_id, org_id)
    references public.files (id, analysis_id, org_id) on delete cascade,
  foreign key (target_file_id, analysis_id, org_id)
    references public.files (id, analysis_id, org_id) on delete cascade,
  unique (source_file_id, target_file_id, kind)
);

-- Method and path are both required: a route that can't be fully recovered
-- isn't stored at all.
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  method text not null,
  path text not null,
  foreign key (analysis_id, org_id) references public.analyses (id, org_id) on delete cascade,
  foreign key (file_id, analysis_id, org_id)
    references public.files (id, analysis_id, org_id) on delete cascade
);

create table public.explanations (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  content text not null,
  model text not null,
  created_at timestamptz not null default now(),
  foreign key (analysis_id, org_id) references public.analyses (id, org_id) on delete cascade,
  foreign key (file_id, analysis_id, org_id)
    references public.files (id, analysis_id, org_id) on delete cascade
);

-- Where a role came from matters: convention is parsed, AI is a label.
create table public.file_roles (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null unique,
  role text not null,
  source text not null check (source in ('convention', 'ai')),
  foreign key (analysis_id, org_id) references public.analyses (id, org_id) on delete cascade,
  foreign key (file_id, analysis_id, org_id)
    references public.files (id, analysis_id, org_id) on delete cascade
);

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  content text not null,
  created_at timestamptz not null default now(),
  foreign key (analysis_id, org_id) references public.analyses (id, org_id) on delete cascade
);

-- org_id backs every policy and every cascade from an organization delete.
create index on public.projects (org_id);
create index on public.analyses (org_id, created_at desc);
create index on public.analyses (project_id, org_id);
create index on public.files (org_id);
create index on public.edges (org_id);
create index on public.edges (analysis_id);
create index on public.edges (target_file_id);
create index on public.routes (org_id);
create index on public.routes (analysis_id);
create index on public.routes (file_id);
create index on public.explanations (org_id);
create index on public.explanations (analysis_id);
create index on public.explanations (file_id);
create index on public.file_roles (org_id);
create index on public.file_roles (analysis_id);
create index on public.insights (org_id);
create index on public.insights (analysis_id);

-- Nothing writes through the API yet, so signed-in users get read only and
-- anonymous requests get nothing. Rows are then narrowed by policy.
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

create policy "members read their organization"
  on public.organizations for select to authenticated
  using (id = (select private.current_org_id()));

create policy "members read their organization's rows" on public.projects
  for select to authenticated using (org_id = (select private.current_org_id()));
create policy "members read their organization's rows" on public.analyses
  for select to authenticated using (org_id = (select private.current_org_id()));
create policy "members read their organization's rows" on public.files
  for select to authenticated using (org_id = (select private.current_org_id()));
create policy "members read their organization's rows" on public.edges
  for select to authenticated using (org_id = (select private.current_org_id()));
create policy "members read their organization's rows" on public.routes
  for select to authenticated using (org_id = (select private.current_org_id()));
create policy "members read their organization's rows" on public.explanations
  for select to authenticated using (org_id = (select private.current_org_id()));
create policy "members read their organization's rows" on public.file_roles
  for select to authenticated using (org_id = (select private.current_org_id()));
create policy "members read their organization's rows" on public.insights
  for select to authenticated using (org_id = (select private.current_org_id()));
