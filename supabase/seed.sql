-- Stand-in organizations and projects. Two Clerk
-- organizations, so switching between them shows the policy at work. Fixed ids
-- make this safe to run again.

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
