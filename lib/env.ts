// Every variable is read by its literal name so Next can inline the
// NEXT_PUBLIC_ ones into client bundles; a dynamic lookup would be undefined
// in the browser.
const values = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL,
  NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL:
    process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL,
  NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL:
    process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  // No NEXT_PUBLIC_ prefix, so Next never inlines it into a browser bundle.
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
};

type EnvName = keyof typeof values;

// Called from next.config.ts, so a missing or blank value stops `next dev` and
// `next build` on boot instead of surfacing as a confusing auth error later.
export function assertEnv(): void {
  const missing = (Object.keys(values) as EnvName[]).filter(
    (name) => !values[name]?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables (set them in .env.local):\n  ${missing.join("\n  ")}`,
    );
  }
}

export function env(name: EnvName): string {
  const value = values[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
