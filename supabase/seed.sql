-- Stand-in rows until analyses can be created for real. Two Clerk
-- organizations, so switching between them shows the policy at work. Fixed ids
-- make this safe to run again.
--
-- No commit SHAs: these analyses never ran, so there is no commit to name.

insert into public.organizations (id, name) values
  ('org_3KRyJTQV2EJUMxj2699NN160pU6', 'Nafisa''s Organization'),
  ('org_3KS3LlgoaQxgipPWiKOmv7eHYjH', 'Seed Org B')
on conflict (id) do nothing;

insert into public.projects (id, org_id, repo_owner, repo_name) values
  ('00000000-0000-4000-a000-000000000001', 'org_3KRyJTQV2EJUMxj2699NN160pU6', 'vercel', 'swr'),
  ('00000000-0000-4000-a000-000000000002', 'org_3KRyJTQV2EJUMxj2699NN160pU6', 'colinhacks', 'zod'),
  ('00000000-0000-4000-b000-000000000001', 'org_3KS3LlgoaQxgipPWiKOmv7eHYjH', 'pmndrs', 'zustand'),
  ('00000000-0000-4000-b000-000000000002', 'org_3KS3LlgoaQxgipPWiKOmv7eHYjH', 'sindresorhus', 'ky')
on conflict (id) do nothing;

insert into public.analyses (id, org_id, project_id, status, error, created_at, finished_at) values
  ('00000000-0000-4000-a100-000000000001', 'org_3KRyJTQV2EJUMxj2699NN160pU6',
   '00000000-0000-4000-a000-000000000001', 'complete', null,
   now() - interval '2 days', now() - interval '2 days' + interval '41 seconds'),
  ('00000000-0000-4000-a100-000000000002', 'org_3KRyJTQV2EJUMxj2699NN160pU6',
   '00000000-0000-4000-a000-000000000002', 'failed', 'Repository download timed out',
   now() - interval '5 hours', now() - interval '5 hours' + interval '30 seconds'),
  ('00000000-0000-4000-a100-000000000003', 'org_3KRyJTQV2EJUMxj2699NN160pU6',
   '00000000-0000-4000-a000-000000000001', 'running', null,
   now() - interval '3 minutes', null),
  ('00000000-0000-4000-b100-000000000001', 'org_3KS3LlgoaQxgipPWiKOmv7eHYjH',
   '00000000-0000-4000-b000-000000000001', 'complete', null,
   now() - interval '1 day', now() - interval '1 day' + interval '18 seconds'),
  ('00000000-0000-4000-b100-000000000002', 'org_3KS3LlgoaQxgipPWiKOmv7eHYjH',
   '00000000-0000-4000-b000-000000000002', 'queued', null,
   now() - interval '1 minute', null)
on conflict (id) do nothing;
