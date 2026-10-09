import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { env } from "./env";

// Sessions belong to Clerk, so this client never stores or refreshes one of its
// own. Every request carries the current Clerk session token instead, which is
// what lets a row-level policy read the organization claim off it. Without the
// token the client would query as anon and a policy would return nothing.
export async function createServerSupabase() {
  const { getToken } = await auth();
  return createClient<Database>(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      accessToken: () => getToken(),
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
