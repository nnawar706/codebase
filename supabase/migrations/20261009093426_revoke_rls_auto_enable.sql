-- Supabase's own RLS trigger function sits in the exposed schema with EXECUTE
-- granted to API roles. It's security definer, so it shouldn't be callable
-- over the API at all. Event triggers don't check EXECUTE when they fire, so
-- revoking it changes nothing about the trigger itself.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
