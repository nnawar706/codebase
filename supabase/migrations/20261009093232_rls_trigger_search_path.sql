-- Supabase ships its own RLS trigger (ensure_rls). Both stay: that one isn't in
-- version control and only logs when it fails, while this one is tracked here
-- and aborts the CREATE TABLE if it can't enable RLS.
--
-- Pin search_path so a role that shadows a function in another schema can't
-- change what this runs. object_identity is already schema-qualified, and
-- pg_catalog is always searched, so nothing in the body needs it.
alter function private.enable_rls_on_new_table() set search_path = '';
