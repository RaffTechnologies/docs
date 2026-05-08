#!/usr/bin/env node
// One-shot: split images/products/build/vm/ (47 files) into subdirectories
// matching MDX page sections, so no single directory exceeds Mintlify's
// undocumented per-directory threshold (~30 files).

import { execSync } from "node:child_process";
import { readdirSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const VM = "images/products/build/vm";

// Map filename prefix → subdirectory
const ROUTES = [
  { prefix: "create-a-vm-",         dest: "create" },
  { prefix: "payment-methods",      dest: "create" },
  { prefix: "connect-via-",         dest: "connect" },
  { prefix: "manage-power-",        dest: "manage" },
  { prefix: "rename-",              dest: "manage" },
  { prefix: "resize-",              dest: "manage" },
  { prefix: "reset-password-",      dest: "manage" },
  { prefix: "factory-reset-",       dest: "manage" },
  { prefix: "reinstall-",           dest: "manage" },
  { prefix: "create-snapshot-",     dest: "snapshots-backups" },
  { prefix: "enable-backups-",      dest: "snapshots-backups" },
  { prefix: "delete-vm-",           dest: "delete" },
  { prefix: "monitoring-",          dest: "concepts" },
  { prefix: "tags-",                dest: "concepts" },
  { prefix: "vm-notes-",            dest: "concepts" },
];

const files = readdirSync(resolve(ROOT, VM)).filter((f) => f.endsWith(".png"));
const moves = []; // [from, to]

for (const f of files) {
  const route = ROUTES.find((r) => f.startsWith(r.prefix));
  if (!route) {
    console.log(`ROOT  ${f}  (stays in vm/)`);
    continue;
  }
  const from = `${VM}/${f}`;
  const to = `${VM}/${route.dest}/${f}`;
  moves.push([from, to]);
}

console.log(`\nMoving ${moves.length} files into subdirectories...`);

// Ensure target dirs exist
const dests = [...new Set(moves.map((m) => dirname(m[1])))];
for (const d of dests) {
  mkdirSync(resolve(ROOT, d), { recursive: true });
}

// git mv each file
for (const [from, to] of moves) {
  execSync(`git mv "${from}" "${to}"`, { cwd: ROOT });
}
console.log(`✓ ${moves.length} files moved`);

// Now rewrite MDX references
const mdxFiles = execSync(
  `git ls-files -- '*.mdx' ':!:node_modules/**'`,
  { cwd: ROOT, encoding: "utf8" },
)
  .trim()
  .split("\n");

let mdxChanged = 0;
const fs = await import("node:fs/promises");
for (const path of mdxFiles) {
  const full = resolve(ROOT, path);
  let content = await fs.readFile(full, "utf8");
  let changed = false;
  for (const [from, to] of moves) {
    const fromUrl = "/" + from;
    const toUrl = "/" + to;
    if (content.includes(fromUrl)) {
      content = content.split(fromUrl).join(toUrl);
      changed = true;
    }
  }
  if (changed) {
    await fs.writeFile(full, content);
    mdxChanged++;
  }
}

console.log(`✓ ${mdxChanged} MDX files updated`);
console.log(`\nDirectory layout after split:`);
for (const d of [...dests, VM].sort()) {
  const count = readdirSync(resolve(ROOT, d)).filter((f) => f.endsWith(".png")).length;
  console.log(`  ${count.toString().padStart(3)} files  ${d}/`);
}
