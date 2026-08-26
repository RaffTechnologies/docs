#!/usr/bin/env node
// Calls every documented read-only endpoint against a live API and checks two
// things the static checks cannot: that the endpoint actually works, and that
// its response carries no field the public spec does not declare.
//
// The second check is the one that matters — an undeclared field in a response
// is an internal field leaking into the public API.
//
//   RAFF_API_KEY=... node scripts/smoke-docs.mjs
//   RAFF_API_KEY=... node scripts/smoke-docs.mjs --base https://api.raffcomputing.com
//   RAFF_API_KEY=... node scripts/smoke-docs.mjs --verbose
//
// GET only, always. Nothing here mutates state, so it is safe against prod.

import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const VERBOSE = argv.includes("--verbose");
const BASE = (flag("base", "https://api.rafftechnologies.com")).replace(/\/$/, "");

const API_KEY = process.env.RAFF_API_KEY;
if (!API_KEY) {
  console.error("RAFF_API_KEY is not set. Export a read-scoped key and re-run.");
  process.exit(2);
}

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const spec = JSON.parse(
  execFileSync("npx", ["--yes", "js-yaml", join(ROOT, "api-reference", "openapi.yaml")], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);

const deref = (node, seen = new Set()) => {
  if (!node || typeof node !== "object") return node;
  if (node.$ref) {
    if (seen.has(node.$ref)) return {}; // recursive schema — stop descending
    const target = node.$ref
      .replace(/^#\//, "")
      .split("/")
      .reduce((acc, key) => acc?.[key], spec);
    return deref(target, new Set([...seen, node.$ref]));
  }
  return node;
};

// The set of property names a schema permits. Returns null when the schema does
// not constrain its keys, which means "cannot judge" rather than "no extras".
function allowedKeys(schema, seen = new Set()) {
  const s = deref(schema, seen);
  if (!s || typeof s !== "object") return null;
  if (s.additionalProperties === true || s.additionalProperties === undefined && !s.properties && !s.allOf && !s.oneOf && !s.anyOf)
    return null;

  const keys = new Set(Object.keys(s.properties ?? {}));
  // A composed schema permits the union of its branches; treating it as the
  // union keeps us from flagging a legitimate variant's fields as extras.
  for (const branch of [...(s.allOf ?? []), ...(s.oneOf ?? []), ...(s.anyOf ?? [])]) {
    const branchKeys = allowedKeys(branch, seen);
    if (branchKeys === null) return null;
    branchKeys.forEach((k) => keys.add(k));
  }
  return keys.size ? keys : null;
}

// Walks a response body against its schema, collecting dotted paths of fields
// the spec never declares.
function findExtras(body, schema, path = "", out = [], seen = new Set()) {
  const s = deref(schema, seen);
  if (!s || !body || typeof body !== "object") return out;

  if (Array.isArray(body)) {
    const items = s.items ?? (s.type === "array" ? s.items : null);
    if (items) body.slice(0, 5).forEach((el, i) => findExtras(el, items, `${path}[${i}]`, out, seen));
    return out;
  }

  const allowed = allowedKeys(s, seen);
  if (allowed === null) return out; // unconstrained — nothing to assert

  const props = { ...(deref(s, seen).properties ?? {}) };
  for (const branch of [...(s.allOf ?? []), ...(s.oneOf ?? []), ...(s.anyOf ?? [])])
    Object.assign(props, deref(branch, seen).properties ?? {});

  for (const [key, value] of Object.entries(body)) {
    const here = path ? `${path}.${key}` : key;
    if (!allowed.has(key)) out.push(here);
    else if (value && typeof value === "object") findExtras(value, props[key], here, out, seen);
  }
  return out;
}

// Only GETs, and only those needing no path parameter — an id we would have to
// invent. Collection and catalog endpoints cover the response shapes anyway.
const targets = [];
const FILTER = flag("filter", "");
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  if (!item.get || path.includes("{") || path === "/health") continue;
  if (FILTER && !path.includes(FILTER)) continue;
  targets.push({ path, op: item.get });
}

const ok = [];
const failed = [];
const leaks = [];

for (const { path, op } of targets) {
  const url = `${BASE}${path}`;
  let res, body;
  try {
    res = await fetch(url, {
      headers: { "X-API-Key": API_KEY, Accept: "application/json" },
    });
    body = await res.json().catch(() => null);
  } catch (err) {
    failed.push(`GET ${path} — request failed: ${err.message}`);
    continue;
  }

  if (!res.ok) {
    failed.push(`GET ${path} — HTTP ${res.status} ${JSON.stringify(body)?.slice(0, 160) ?? ""}`);
    continue;
  }

  ok.push(path);
  const schema = op.responses?.["200"]?.content?.["application/json"]?.schema;
  if (!schema) continue;
  const extras = [...new Set(findExtras(body, schema))].map((f) => f.replace(/\[\d+\]/g, "[]"));
  if (extras.length) leaks.push({ path, extras: [...new Set(extras)] });
  if (VERBOSE) console.log(`  ${res.status} GET ${path}`);
}

console.log(`\n${BASE}`);
console.log(`  ${ok.length}/${targets.length} documented read-only endpoints responded 2xx`);

if (failed.length) {
  console.error(`\n✗ endpoints that did not respond 2xx (${failed.length})`);
  for (const line of failed) console.error(`    ${line}`);
}

if (leaks.length) {
  console.error(`\n✗ responses carrying fields the public spec does not declare (${leaks.length})`);
  for (const { path, extras } of leaks) console.error(`    GET ${path}\n        ${extras.join("\n        ")}`);
}

if (failed.length || leaks.length) process.exit(1);
console.log("✓ smoke passed");
