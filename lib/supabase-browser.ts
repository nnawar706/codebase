"use client";

import { useSession } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import type { Database } from "./database.types";
import { env } from "./env";

// The browser's client authenticates exactly like the server's: the Clerk
// session token, read fresh on each request, so the policy sees the same
// organization claim. A bare client would join channels as anon, and every
// private channel would refuse it.
export function useBrowserSupabase() {
  const { session } = useSession();
  return useMemo(
    () =>
      createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
        accessToken: async () => (await session?.getToken()) ?? null,
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    [session],
  );
}
