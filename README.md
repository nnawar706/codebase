# Codebase

Paste a public GitHub repository URL and get a dependency map of it. Folders are
boxes, imports are lines between them. Open a folder into its files, select a
file and see what it imports, what imports it, and what is affected two levels
out if it changes. Ask for an explanation and get a paragraph written from that
file and its real neighbors.

It's built for a developer opening a codebase they didn't write, very often one
they built themselves with an agent across many sessions and can no longer hold
in their head. They can read the code. What they can't see is its shape.

## The rule everything rests on

Every box and every line comes from really parsing the code. An edge exists
because the parser resolved a real import to a real file. Imports it can't
resolve are reported with a reason, never guessed. The AI explains and labels
what the parser found, but it never decides that two files are connected.

This tool explains a codebase. It doesn't review one, so there are no scores,
grades or "issues found".

## What it does

- Sign in with Clerk (GitHub, Google or email), identity only. No repo scope and
  no stored tokens, so public repositories only.
- Every analysis belongs to an organization. Anyone in it sees the same maps,
  and nobody outside it does, enforced by Postgres row-level security.
- Parses TypeScript and JavaScript: static imports, re-exports, dynamic
  `import()` and `require()`, with path aliases and index files resolved.
- Framework adapters for Next.js, React, NestJS, Express and Node recognise what
  kind of file something is without the parser knowing frameworks exist.
- Coverage reporting: how much of the repository was parsed and why the rest
  wasn't.
- Fan-in, fan-out, blast radius and dependency chains, computed as plain
  arithmetic over the edge list, so they appear instantly.
- Live progress while a repository is downloaded and parsed.
- File and folder explanations from Gemini, always cached and traced in
  LangSmith.

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript strict |
| Parsing | ts-morph |
| Map | React Flow (`@xyflow/react`) with dagre layout |
| Auth and teams | Clerk, with organizations |
| Database | Supabase Postgres, row-level security, realtime |
| AI | Google Gemini (`@google/genai`) through one wrapped client |
| Tracing | LangSmith |
| Styling | Tailwind CSS v4 |

## Project layout

| Path | What lives there |
| --- | --- |
| `parser/` | Standalone parser. Directory in, files, edges and coverage out. No Next, React or database imports. |
| `parser/adapters/` | Framework knowledge, one adapter per framework. |
| `pipeline/` | Downloads a GitHub tarball, runs the parser and stores the result. |
| `lib/graph/`, `lib/map/` | Pure graph calculations and map folding. |
| `lib/ai/` | The single AI client, the cache, and the explain and label calls. |
| `app/`, `components/` | Next.js routes and the UI. |
| `supabase/migrations/` | Schema, policies and realtime setup. |
| `scripts/` | Command-line runners for the parser and pipeline. |
| `docs/` | `project-doc.md` holds every product decision and its reasoning. `specs/` holds one spec per build phase. |

## Running it locally

You need Node 24 or later (the scripts in `scripts/` run TypeScript directly),
a Clerk application, a Supabase project and a Google AI API key. LangSmith is
optional.

**1. Install**

```bash
npm install
```

**2. Clerk.** Create an application, enable Organizations, and turn on the
GitHub, Google and email sign-in methods you want.

**3. Supabase.** Create a project and add Clerk as a third-party auth provider
(Authentication → Third-party auth). That lets row-level policies read the
organization claim straight off the Clerk session token. Then apply the
migrations, for example with the Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

**4. Environment.** Copy `.env.example` to `.env.local` and fill it in:

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → API keys (publishable) |
| `SUPABASE_SECRET_KEY` | Supabase → API keys (secret). Server only. |
| `SUPABASE_PASSWORD` | The database password you set on the project |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk dashboard → API keys |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` etc. | Leave the defaults from `.env.example` |
| `GOOGLE_API_KEY` | Google AI Studio. Server only. |
| `LANGSMITH_*` | Optional. Without them explanations still work and the UI says tracing is off. |

**5. Run**

```bash
npm run dev
```

Open http://localhost:3000, sign in, create or join an organization, and paste
a public repository URL on the dashboard.

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint
npx tsc --noEmit  # type check
```

The parser and pipeline can also be run without the web app:

```bash
# Parse a local directory and print files, edges and coverage
node scripts/parse.ts <dir> [--out result.json]

# Fold a parse result the way the map does
node scripts/fold.ts result.json

# Print insights (fan-in/out, loops) for a parse result
node scripts/insights.ts result.json

# Run the full pipeline for a repository into an organization
node --env-file=.env.local scripts/analyze.ts <github-url> <org_id> [--rerun]
```

## Limits

- Public repositories only.
- TypeScript and JavaScript only. Getting one language genuinely right is the
  point.
- One deployable app, no queues or workers. A repository too large to parse in
  a request is reported as such rather than worked around.
- Routes are shown only when both the method and the full path can be recovered
  from the syntax. A partial route is shown as nothing.

## How it's built

Development is spec driven. `docs/project-doc.md` explains what the app is and
why each decision was made, and `docs/specs/phase-NN.md` defines each phase's
behavior and acceptance check. `CLAUDE.md` holds the standing rules for working
on the code.
