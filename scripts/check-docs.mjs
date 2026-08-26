#!/usr/bin/env node
// Guards the three things that can silently drift apart: the OpenAPI spec, the
// MDX pages that render it, and the docs.json sidebar that links to them.
//
//   node scripts/check-docs.mjs             # run every check
//   node scripts/check-docs.mjs --nav       # only nav <-> file consistency
//   node scripts/check-docs.mjs --coverage  # only spec <-> page coverage
//
// Exits non-zero when any check fails, so it can gate a deploy.
//
// Reading the spec needs a YAML parser; we shell out to the js-yaml CLI the
// same way the root Makefile shells out to @redocly/cli.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const args = new Set(process.argv.slice(2));
const ONLY_NAV = args.has("--nav");
const ONLY_COVERAGE = args.has("--coverage");
const RUN_NAV = ONLY_NAV || !ONLY_COVERAGE;
const RUN_COVERAGE = ONLY_COVERAGE || !ONLY_NAV;

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const SPEC = join(ROOT, "api-reference", "openapi.yaml");

// Directories that hold routable pages. Anything outside these (images, logo,
// contributing/) is not expected to appear in the sidebar.
const PAGE_DIRS = ["api-reference", "products", "guides", "reference"];
// Root-level pages that live outside PAGE_DIRS.
const ROOT_PAGES = ["introduction", "quickstart", "authentication"];
// `_template*.mdx` are copyable scaffolds, deliberately unreferenced.
const isTemplate = (p) => /(^|\/)_/.test(p);

const failures = [];
const fail = (check, lines) => {
  if (lines.length) failures.push({ check, lines });
};

function walkMdx(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkMdx(full));
    else if (entry.endsWith(".mdx")) out.push(relative(ROOT, full));
  }
  return out;
}

// Every string in docs.json under a "pages" array is a page slug.
function navPages(node, acc = new Set()) {
  if (typeof node === "string") acc.add(node);
  else if (Array.isArray(node)) node.forEach((n) => navPages(n, acc));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "pages") navPages(value, acc);
      else if (typeof value === "object") navPages(value, acc);
    }
  }
  return acc;
}

// Pages can also be reached by href rather than by sidebar entry — the global
// anchors and the navbar links both point at internal slugs that way.
function navHrefs(node, acc = new Set()) {
  if (Array.isArray(node)) node.forEach((n) => navHrefs(n, acc));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "href" && typeof value === "string" && value.startsWith("/"))
        acc.add(value.slice(1));
      else if (typeof value === "object") navHrefs(value, acc);
    }
  }
  return acc;
}

const docsJson = JSON.parse(readFileSync(join(ROOT, "docs.json"), "utf8"));
const nav = navPages(docsJson.navigation);
const linked = navHrefs(docsJson);
const allMdx = PAGE_DIRS.flatMap((d) => walkMdx(join(ROOT, d)));
const slugOf = (p) => p.replace(/\.mdx$/, "");

if (RUN_NAV) {
  // 1. Every sidebar entry resolves to a file on disk.
  fail(
    "nav entries with no file",
    [...nav]
      .filter((page) => !existsSync(join(ROOT, `${page}.mdx`)))
      .map((page) => `${page} -> ${page}.mdx not found`),
  );

  // 2. Every page on disk is reachable from the sidebar. This is the check that
  //    catches a spec landing without nav entries.
  const reachable = new Set([...nav, ...linked, ...ROOT_PAGES]);
  fail(
    "orphaned pages (exist but not in docs.json)",
    allMdx
      .filter((p) => !isTemplate(p) && !reachable.has(slugOf(p)))
      .map((p) => p),
  );
}

if (RUN_COVERAGE) {
  const spec = JSON.parse(
    execFileSync("npx", ["--yes", "js-yaml", SPEC], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );

  // Operations the spec defines, as the "METHOD /path" string an MDX page uses
  // in its `openapi:` frontmatter.
  const METHODS = ["get", "post", "put", "patch", "delete"];
  const specOps = new Set();
  for (const [path, item] of Object.entries(spec.paths ?? {}))
    for (const method of METHODS)
      if (item[method]) specOps.add(`${method.toUpperCase()} ${path}`);

  // Operations the MDX pages claim to document.
  const documented = new Map(); // "METHOD /path" -> page slug
  const FRONTMATTER_OPENAPI = /^openapi:\s*"?([A-Z]+\s+\/[^"\n]*?)"?\s*$/m;
  for (const page of allMdx) {
    if (isTemplate(page)) continue;
    const match = readFileSync(join(ROOT, page), "utf8").match(FRONTMATTER_OPENAPI);
    if (match) documented.set(match[1].trim(), slugOf(page));
  }

  // 3. Every spec operation has a page. Health checks are infrastructure, not
  //    something a customer calls, so they are exempt.
  fail(
    "spec operations with no MDX page",
    [...specOps]
      .filter((op) => !documented.has(op) && !op.endsWith(" /health"))
      .sort(),
  );

  // 4. No page documents an operation the spec dropped.
  fail(
    "MDX pages referencing an operation not in the spec",
    [...documented]
      .filter(([op]) => !specOps.has(op))
      .map(([op, page]) => `${page} -> ${op}`)
      .sort(),
  );

  // 5. A documented operation nobody can navigate to is as good as undocumented.
  fail(
    "endpoint pages missing from docs.json",
    [...documented]
      .filter(([, page]) => !nav.has(page))
      .map(([op, page]) => `${page} (${op})`)
      .sort(),
  );
}

if (!failures.length) {
  console.log("✓ docs check passed");
  process.exit(0);
}

for (const { check, lines } of failures) {
  console.error(`\n✗ ${check} (${lines.length})`);
  for (const line of lines) console.error(`    ${line}`);
}
console.error(
  `\n${failures.reduce((n, f) => n + f.lines.length, 0)} problem(s) across ${failures.length} check(s).`,
);
process.exit(1);
