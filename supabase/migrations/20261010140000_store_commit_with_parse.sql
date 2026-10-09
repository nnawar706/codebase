-- analyses.commit_sha names the commit the stored map was parsed from. It used
-- to be written as soon as the archive downloaded, so a re-run that fetched a
-- newer commit and then failed left the row naming a commit nothing stored
-- came from. It's now written in the same transaction as the files and edges,
-- so the two can't disagree.
--
-- Dropped rather than replaced: adding an argument with create or replace
-- would leave the old signature behind as a second function.
drop function public.store_parse(uuid, text, jsonb, jsonb, jsonb);

create function public.store_parse(
  p_analysis_id uuid,
  p_commit_sha text,
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
      commit_sha = p_commit_sha,
      adapter = p_adapter,
      coverage = p_coverage,
      stage_message = format('Stored %s files and %s edges',
        jsonb_array_length(p_files), jsonb_array_length(p_edges)),
      error = null,
      finished_at = now()
  where id = p_analysis_id;
end;
$$;

revoke execute on function public.store_parse(uuid, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.store_parse(uuid, text, text, jsonb, jsonb, jsonb) to service_role;
