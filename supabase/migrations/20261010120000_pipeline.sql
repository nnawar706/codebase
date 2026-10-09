-- What a real run needs to store: the stage it's in, what the parser found,
-- and the commit it found it in.

-- The stage is the last one entered, so a failed run still says where it
-- failed. Null only while queued.
alter table public.analyses
  add column stage text check (stage in ('fetching', 'selecting', 'parsing', 'storing')),
  add column stage_message text,
  add column adapter text,
  -- The parser's coverage report, read and written as one unit and validated
  -- on read. Nothing queries inside it, so it isn't split into tables.
  add column coverage jsonb,
  add constraint analyses_commit_sha_format check (commit_sha ~ '^[0-9a-f]{40}$'),
  -- A repository is analyzed once; re-running replaces that analysis's rows
  -- rather than adding a second analysis beside it.
  add constraint analyses_one_per_project unique (project_id),
  -- Only one direction: a re-run keeps the last coverage until it's replaced,
  -- so the map stays readable while it runs.
  add constraint analyses_complete_has_coverage
    check (status <> 'complete' or (coverage is not null and adapter is not null));

-- Fan-in and fan-out aren't stored: they're arithmetic over the edges.
alter table public.files
  add column lines integer not null check (lines >= 0),
  add column hash text not null check (hash ~ '^[0-9a-f]{64}$');

-- Stores a parse in one transaction and marks the analysis complete in the
-- same one, so a row never says complete over half its files, and a failure
-- partway leaves nothing behind. Rows are replaced, not merged, so a re-run
-- can't keep a file that no longer exists.
--
-- An edge whose end isn't among the files is an error, not a dropped row: the
-- parser guarantees both ends exist, so a mismatch means something upstream
-- is wrong and must not be drawn around.
create function public.store_parse(
  p_analysis_id uuid,
  p_adapter text,
  p_files jsonb,
  p_edges jsonb,
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

  update public.analyses
  set status = 'complete',
      adapter = p_adapter,
      coverage = p_coverage,
      stage_message = format('Stored %s files and %s edges',
        jsonb_array_length(p_files), jsonb_array_length(p_edges)),
      error = null,
      finished_at = now()
  where id = p_analysis_id;
end;
$$;

-- Only the pipeline writes, using the secret key. Exposed in public because
-- that's where the API can call it, so it's closed to everyone else.
revoke execute on function public.store_parse(uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.store_parse(uuid, text, jsonb, jsonb, jsonb) to service_role;
