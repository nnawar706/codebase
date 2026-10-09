import { open } from "node:fs/promises";

export interface RepoRef {
  owner: string;
  name: string;
}

// Past this the download is stopped, not finished. A repository this large is
// a limit to state, not something to work around.
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

const HEADERS = { "User-Agent": "codebase-map" };
const SEGMENT = /^[A-Za-z0-9_.-]+$/;

/**
 * Accepts github.com/owner/name with or without a scheme, a trailing slash or
 * `.git`. Anything after the name (a branch, a folder) is refused rather than
 * ignored, because analyzing the default branch would not be what was pasted.
 *
 * Lowercased because GitHub names are case-insensitive: two spellings of one
 * repository must not become two projects.
 */
export function parseRepoUrl(input: string): RepoRef {
  const trimmed = input.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const match = trimmed.match(/^github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!match) {
    throw new Error(`"${input}" is not a repository URL. Expected https://github.com/owner/name`);
  }
  const [, owner, name] = match;
  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) {
    throw new Error(`"${owner}/${name}" contains characters GitHub doesn't allow in a repository name`);
  }
  return { owner: owner.toLowerCase(), name: name.toLowerCase() };
}

const rateLimitMessage = (res: Response) => {
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  const at = Number.isFinite(reset) && reset > 0 ? ` It resets at ${new Date(reset * 1000).toISOString()}.` : "";
  return `GitHub's limit of 60 unauthenticated API requests an hour is used up.${at}`;
};

/**
 * The commit the default branch points at now. The archive is then fetched by
 * this SHA rather than by branch, so what's stored is exactly what's recorded,
 * even if someone pushes in between.
 */
export async function resolveHeadCommit({ owner, name }: RepoRef): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${name}/commits/HEAD`, {
    headers: { ...HEADERS, Accept: "application/vnd.github.sha" },
  });
  if (res.status === 404 || res.status === 422) {
    throw new Error(`github.com/${owner}/${name} doesn't exist or isn't public`);
  }
  if (res.status === 409) throw new Error(`github.com/${owner}/${name} is empty: it has no commits`);
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    throw new Error(rateLimitMessage(res));
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText} when asked for the latest commit`);
  const sha = (await res.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`GitHub returned "${sha.slice(0, 60)}" where a commit SHA was expected`);
  return sha;
}

/** Streams the archive for one commit to `file`. Returns its size in bytes. */
export async function downloadArchive({ owner, name }: RepoRef, sha: string, file: string): Promise<number> {
  const res = await fetch(`https://codeload.github.com/${owner}/${name}/tar.gz/${sha}`, { headers: HEADERS });
  if (!res.ok || !res.body) {
    throw new Error(`Downloading the archive failed: GitHub answered ${res.status} ${res.statusText}`);
  }
  const tooLarge = () =>
    new Error(`The archive is larger than ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB, which is more than one request can parse`);
  if (Number(res.headers.get("content-length")) > MAX_ARCHIVE_BYTES) throw tooLarge();

  const out = await open(file, "w");
  const reader = res.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_ARCHIVE_BYTES) throw tooLarge();
      await out.write(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    await out.close();
  }
  return bytes;
}
