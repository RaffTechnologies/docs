#!/usr/bin/env node
// Stamps every .mdx page with `<sub>Updated MMM D, YYYY</sub>` derived from
// the file's last git commit date. Idempotent: re-running updates the date
// in place. Run before `mintlify dev` or before deploy.
//
//   node scripts/stamp-dates.mjs            # stamp all .mdx files
//   node scripts/stamp-dates.mjs --check    # exit non-zero if any file would change (CI)
//   node scripts/stamp-dates.mjs --dry      # print what would change, don't write

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const CHECK = args.has("--check");
const DRY = args.has("--dry") || CHECK;

const ROOT = resolve(new URL("..", import.meta.url).pathname);
// Matches an existing stamp line plus any blank lines that follow it, so a
// replacement always normalizes to "<stamp>\n\n" — exactly one blank line
// between stamp and the next paragraph.
const SUB_RE = /^<sub>Updated [A-Z][a-z]+ \d{1,2}, \d{4}<\/sub>[ \t]*\n+/m;
const FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

function listMdx() {
  // Tracked + untracked + modified MDX files, minus deletions and ignored paths.
  // Using `--others --exclude-standard` picks up new files; `--cached` covers tracked ones.
  const out = execSync(
    `git ls-files --cached --others --exclude-standard -- '*.mdx' ':!:node_modules/**' ':!:snippets/**'`,
    { cwd: ROOT, encoding: "utf8" },
  );
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((p) => existsSync(resolve(ROOT, p))); // drop tracked-but-deleted-on-disk
}

function gitDate(path) {
  try {
    const iso = execSync(`git log -1 --format=%cI -- "${path}"`, {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    return iso ? new Date(iso) : null;
  } catch {
    return null;
  }
}

function stamp(content, dateStr) {
  const stampLine = `<sub>Updated ${dateStr}</sub>`;
  const stampBlock = `${stampLine}\n\n`; // always one blank line after

  // Existing stamp anywhere in the file → replace it (regex eats blank lines after,
  // we put exactly one back).
  if (SUB_RE.test(content)) {
    return content.replace(SUB_RE, stampBlock);
  }

  // No frontmatter → prepend stamp at top
  if (!content.startsWith("---\n")) {
    return `${stampBlock}${content}`;
  }

  // Frontmatter present → insert right after the closing `---`
  const fmEnd = content.indexOf("\n---\n", 4);
  if (fmEnd === -1) return content;

  const head = content.slice(0, fmEnd + 5);
  let tail = content.slice(fmEnd + 5);
  // Strip leading blank lines from the body so we don't pile up newlines
  tail = tail.replace(/^\n+/, "");
  return `${head}\n${stampBlock}${tail}`;
}

let changed = 0;
const files = listMdx();

for (const path of files) {
  // Untracked or never-committed files have no git history — fall back to today
  // so a fresh page still ships with a date.
  const date = gitDate(path) ?? new Date();
  const dateStr = FORMAT.format(date);
  const before = readFileSync(resolve(ROOT, path), "utf8");
  const after = stamp(before, dateStr);

  if (before === after) continue;

  changed++;
  if (DRY) {
    console.log(`would stamp: ${path}  →  ${dateStr}`);
  } else {
    writeFileSync(resolve(ROOT, path), after);
    console.log(`stamped: ${path}  →  ${dateStr}`);
  }
}

console.log(
  `\n${changed} file(s) ${DRY ? "would change" : "stamped"}, ${files.length} total.`,
);

if (CHECK && changed > 0) {
  console.error(
    "\n--check failed: stamps are out of date. Run `node scripts/stamp-dates.mjs` to update.",
  );
  process.exit(1);
}
