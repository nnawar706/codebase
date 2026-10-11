// Turns a model's answer into what the Explanation tab draws. The prompt
// allows three kinds of formatting: inline code, bold and "- " bullets. Those
// are rendered. Anything else a model emits anyway (headings, italics, code
// fences, numbered lists, links) is reduced to its text, so no marker ever
// reaches the screen as a stray character.
//
// Pure, and importing nothing, so it runs in the browser and from a script.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  /** A repository path. `code` when it was written as inline code. */
  | { kind: "path"; path: string; code: boolean }
  | { kind: "bold"; children: Inline[] };

export type Block = { kind: "paragraph"; lines: Inline[][] } | { kind: "list"; items: Inline[][] };

const BULLET = /^\s*(?:[-*+•]|\d+[.)])\s+/;
const HEADING = /^\s*#{1,6}\s+/;
const QUOTE = /^\s*>\s?/;
const FENCE = /^\s*(```|~~~)/;
const LINK = /^\[([^\]]+)\]\([^)]*\)/;
// Characters that can end a path in prose without being part of it.
const TRAILING = /[.,;:!?)\]'"]+$/;
const LEADING = /^[(\['"]+/;

/**
 * Splits plain text so every exact repository path becomes its own piece.
 * Only an exact match links: a bare file name could be any of several files,
 * and a link that moves the map to the wrong one is worse than none.
 */
function linkPaths(text: string, paths: ReadonlySet<string>): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(/\S+/g)) {
    const token = match[0];
    const lead = token.match(LEADING)?.[0].length ?? 0;
    let core = token.slice(lead);
    while (core && !paths.has(core) && TRAILING.test(core)) core = core.replace(/.$/, "");
    if (!core || !paths.has(core)) continue;
    const start = (match.index ?? 0) + lead;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    out.push({ kind: "path", path: core, code: false });
    last = start + core.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

// Single asterisks are italics, which aren't rendered, so their markers go.
const plain = (text: string) => text.replace(/\*/g, "");

function inlines(src: string, paths: ReadonlySet<string>): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push(...linkPaths(plain(buffer), paths));
    buffer = "";
  };
  let i = 0;
  while (i < src.length) {
    if (src[i] === "`") {
      const end = src.indexOf("`", i + 1);
      // An unclosed backtick is a stray marker, not the start of code.
      if (end === -1) {
        i += 1;
        continue;
      }
      flush();
      const code = src.slice(i + 1, end);
      const trimmed = code.trim();
      if (trimmed) out.push(paths.has(trimmed) ? { kind: "path", path: trimmed, code: true } : { kind: "code", text: code });
      i = end + 1;
      continue;
    }
    if (src.startsWith("**", i)) {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ kind: "bold", children: inlines(src.slice(i + 2, end), paths) });
        i = end + 2;
      } else {
        i += 2;
      }
      continue;
    }
    if (src[i] === "[") {
      const link = src.slice(i).match(LINK);
      if (link) {
        buffer += link[1];
        i += link[0].length;
        continue;
      }
    }
    buffer += src[i];
    i += 1;
  }
  flush();
  return out;
}

export function parseProse(text: string, paths: ReadonlySet<string>): Block[] {
  const blocks: Block[] = [];
  let paragraph: Inline[][] = [];
  let list: Inline[][] = [];
  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", lines: paragraph });
    paragraph = [];
  };
  const endList = () => {
    if (list.length > 0) blocks.push({ kind: "list", items: list });
    list = [];
  };

  let fenced = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (FENCE.test(raw)) {
      fenced = !fenced;
      continue;
    }
    // A code block isn't allowed, so its lines are shown as code, one each.
    if (fenced) {
      endList();
      if (raw.trim()) paragraph.push([{ kind: "code", text: raw }]);
      continue;
    }
    const line = raw.replace(QUOTE, "");
    if (!line.trim()) {
      endParagraph();
      endList();
      continue;
    }
    if (BULLET.test(line)) {
      endParagraph();
      list.push(inlines(line.replace(BULLET, ""), paths));
      continue;
    }
    endList();
    // A heading isn't allowed either; its words stay, as a bold line.
    if (HEADING.test(line)) {
      endParagraph();
      const words = line.replace(HEADING, "").replace(/\s+#+\s*$/, "");
      blocks.push({ kind: "paragraph", lines: [[{ kind: "bold", children: inlines(words, paths) }]] });
      continue;
    }
    paragraph.push(inlines(line, paths));
  }
  endParagraph();
  endList();
  return blocks;
}
