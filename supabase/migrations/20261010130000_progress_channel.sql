-- Live progress. Each analysis has a private broadcast channel,
-- analysis:<id>. A trigger on our own table publishes to it whenever the
-- stage moves; nothing is attached to the realtime machinery itself.

-- started_at is when the current run began, so a re-run's time is its own.
-- updated_at is when the row last changed: an unfinished run whose
-- updated_at is old has stopped reporting, which is how the dashboard tells
-- abandoned from working.
alter table public.analyses
  add column started_at timestamptz,
  add column updated_at timestamptz not null default now();

create function private.touch_analysis()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger touch_analysis
  before update on public.analyses
  for each row execute function private.touch_analysis();

-- Publishes what a progress line shows and nothing else, so a subscriber has
-- nothing to filter or interpret: the state, the stage, and one message (the
-- reason, once it has failed). Status rides along because a page has to know
-- when to stop watching.
--
-- Security definer because the pipeline's role isn't granted realtime.send;
-- the owner is. The private flag must match the channel the browser opens.
create function private.publish_analysis_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
    or new.stage is distinct from old.stage
    or new.stage_message is distinct from old.stage_message
  then
    perform realtime.send(
      jsonb_build_object(
        'status', new.status,
        'stage', new.stage,
        'message', coalesce(new.error, new.stage_message)
      ),
      'progress',
      'analysis:' || new.id::text,
      true
    );
  end if;
  return null;
end;
$$;

revoke execute on function private.publish_analysis_progress() from public, anon, authenticated;

create trigger publish_analysis_progress
  after update on public.analyses
  for each row execute function private.publish_analysis_progress();

-- Registers the per-analysis channel pattern. Realtime checks this policy when
-- a browser joins a private channel; without it every join is refused and the
-- page simply never updates.
--
-- Joining is allowed exactly when the analysis itself is readable. The
-- subquery runs as the person joining, so the analyses policy decides it: a
-- channel for another organization's analysis matches no row and is refused,
-- for the same reason that row isn't selectable.
create policy "members receive their organization's analysis progress"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'analysis:%'
    and exists (
      select 1 from public.analyses a
      where a.id::text = split_part((select realtime.topic()), ':', 2)
    )
  );
