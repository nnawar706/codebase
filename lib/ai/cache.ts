import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types.ts";
import { MODEL, traced } from "./client.ts";

type Db = SupabaseClient<Database>;

export type Subject = "file" | "folder" | "role";

/** sha256 of a canonical JSON encoding: the same inputs always give the same key. */
export function cacheKey(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

// Reads stay well under the URL length an `in` filter is sent in.
const READ_CHUNK = 200;

/**
 * Where cached answers are read from and written to. Reads are traced as
 * their own run, so a hit shows in the trace as a cache read and nothing else.
 */
export interface Cache {
  read: (subject: Subject, keys: readonly string[]) => Promise<Map<string, string>>;
  write: (subject: Subject, entries: ReadonlyMap<string, string>) => Promise<void>;
}

/**
 * Reads go through `reader`. In the app that's the person's own client, so the
 * policy decides which organization's rows come back and nothing here filters
 * by one. Writes need the secret key, since nobody is granted insert, and so
 * name the organization explicitly.
 *
 * The pipeline has no person's token, so it reads with the secret key too and
 * passes `scope` to stand in for the policy.
 */
export function createCache({ reader, writer, orgId, scope }: { reader: Db; writer: Db; orgId: string; scope: boolean }): Cache {
  const readChunk = async (subject: Subject, keys: readonly string[]) => {
    let query = reader.from("explanations").select("key, content").eq("subject", subject).eq("model", MODEL).in("key", keys);
    if (scope) query = query.eq("org_id", orgId);
    const { data, error } = await query;
    if (error) throw new Error(`Couldn't read the explanation cache: ${error.message}`);
    return data;
  };

  const lookup = traced(
    "cache read",
    async ({ subject, keys }: { subject: Subject; keys: readonly string[] }) => {
      const hits = new Map<string, string>();
      for (let i = 0; i < keys.length; i += READ_CHUNK) {
        for (const row of await readChunk(subject, keys.slice(i, i + READ_CHUNK))) hits.set(row.key, row.content);
      }
      return hits;
    },
    {
      inputs: ({ subject, keys }) => ({ subject, model: MODEL, keys: keys.length }),
      outputs: (hits) => ({ hits: hits.size }),
    },
  );
  const read = (subject: Subject, keys: readonly string[]) => lookup({ subject, keys });

  const write = async (subject: Subject, entries: ReadonlyMap<string, string>) => {
    if (entries.size === 0) return;
    const rows = [...entries].map(([key, content]) => ({ org_id: orgId, subject, key, model: MODEL, content }));
    // Two people asking at once both write; the second is the same answer to
    // the same question, so it's dropped rather than an error.
    const { error } = await writer
      .from("explanations")
      .upsert(rows, { onConflict: "org_id,subject,key,model", ignoreDuplicates: true });
    if (error) throw new Error(`Couldn't write the explanation cache: ${error.message}`);
  };

  return { read, write };
}
