-- The first model calls. Explanations become a cache keyed on what was
-- explained rather than on a file row, and files no adapter matched can carry
-- a role the model gave them.

-- File rows are deleted and recreated on every re-run, so a cache hung off
-- file_id would empty itself even for files that didn't change. Keyed on
-- content instead, it outlives re-runs and is shared by every analysis in the
-- organization that asks the same question. The table has never held a row.
drop table public.explanations;

create table public.explanations (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  -- A file, a folded folder, or a file's role. Each is a different question,
  -- so the same key under two subjects is two entries.
  subject text not null check (subject in ('file', 'folder', 'role')),
  -- sha256 over everything the prompt was built from, and the prompt's own
  -- version, so a changed input or a changed prompt is a miss rather than a
  -- stale hit.
  key text not null check (key ~ '^[0-9a-f]{64}$'),
  -- Part of the cache identity: re-pinning a model misses only its own rows.
  model text not null,
  content text not null,
  created_at timestamptz not null default now(),
  -- Leads with org_id, so it also serves the policy below.
  unique (org_id, subject, key, model)
);

-- New tables in public get Supabase's default grants, which include anon and
-- writes. Brought back to what every other table has: read only, signed in.
-- Writes come from the server with the secret key.
revoke all on public.explanations from anon, authenticated;
grant select on public.explanations to authenticated;

create policy "members read their organization's rows" on public.explanations
  for select to authenticated using (org_id = (select private.current_org_id()));

-- The model labels, convention decides structure. Page, route and controller
-- decide the route table and the entry-point colouring, so a role the model
-- gave can only be one of these. Enforced here so no code path can store
-- anything else.
alter table public.file_roles
  add constraint file_roles_ai_not_structural
    check (source <> 'ai' or role in ('service', 'repository', 'model', 'util', 'config', 'component', 'hook'));

-- Labelling is its own stage: it's a model call, it takes seconds, and it can
-- fail on its own without the map failing.
alter table public.analyses drop constraint analyses_stage_check;
alter table public.analyses
  add constraint analyses_stage_check
    check (stage in ('fetching', 'selecting', 'parsing', 'labelling', 'storing')),
  -- Why the files no convention matched have no model-given role, when the
  -- labelling step didn't run or failed. Null when it ran.
  add column label_error text;

-- Same signature, so replaced in place. The only change: a file can carry a
-- "label", stored as an 'ai' role, and only where convention gave it none.
create or replace function public.store_parse(
  p_analysis_id uuid,
  p_commit_sha text,
  p_adapter text,
  p_files jsonb,
  p_edges jsonb,
  p_routes jsonb,
  p_coverage jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_org text;
  v_count integer;
begin
  select org_id into strict v_org from public.analyses where id = p_analysis_id for update;

  delete from public.files where analysis_id = p_analysis_id;

  insert into public.files (org_id, analysis_id, path, lines, hash)
  select v_org, p_analysis_id, f ->> 'path', (f ->> 'lines')::integer, f ->> 'hash'
  from jsonb_array_elements(p_files) f;

  insert into public.file_roles (org_id, analysis_id, file_id, role, source)
  select v_org, p_analysis_id, fi.id, f ->> 'role', 'convention'
  from jsonb_array_elements(p_files) f
  join public.files fi on fi.analysis_id = p_analysis_id and fi.path = f ->> 'path'
  where f ->> 'role' is not null;

  insert into public.file_roles (org_id, analysis_id, file_id, role, source)
  select v_org, p_analysis_id, fi.id, f ->> 'label', 'ai'
  from jsonb_array_elements(p_files) f
  join public.files fi on fi.analysis_id = p_analysis_id and fi.path = f ->> 'path'
  where f ->> 'role' is null and f ->> 'label' is not null;

  insert into public.edges (org_id, analysis_id, source_file_id, target_file_id, kind)
  select v_org, p_analysis_id, s.id, t.id, e ->> 'kind'
  from jsonb_array_elements(p_edges) e
  join public.files s on s.analysis_id = p_analysis_id and s.path = e ->> 'from'
  join public.files t on t.analysis_id = p_analysis_id and t.path = e ->> 'to';
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_edges) then
    raise exception 'stored % of % edges: an edge names a file that is not in the parse',
      v_count, jsonb_array_length(p_edges);
  end if;

  insert into public.routes (org_id, analysis_id, file_id, method, path, line)
  select v_org, p_analysis_id, fi.id, r ->> 'method', r ->> 'path', (r ->> 'line')::integer
  from jsonb_array_elements(p_routes) r
  join public.files fi on fi.analysis_id = p_analysis_id and fi.path = r ->> 'file';
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_routes) then
    raise exception 'stored % of % routes: a route names a file that is not in the parse',
      v_count, jsonb_array_length(p_routes);
  end if;

  update public.analyses
  set status = 'complete',
      commit_sha = p_commit_sha,
      adapter = p_adapter,
      coverage = p_coverage,
      stage_message = format('Stored %s files, %s edges and %s routes',
        jsonb_array_length(p_files), jsonb_array_length(p_edges), jsonb_array_length(p_routes)),
      error = null,
      finished_at = now()
  where id = p_analysis_id;
end;
$$;
