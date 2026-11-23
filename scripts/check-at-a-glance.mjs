#!/usr/bin/env node
// Checks the prices in snippets/vm-at-a-glance.mdx against the live public pricing API, so the one facts block
// that AI tools quote from the docs cannot drift from what customers are charged.
//
//   node scripts/check-at-a-glance.mjs
//
// Exits non-zero when a price in the snippet no longer matches. The Windows licence rule ($6 per vCPU, 2 vCPU
// minimum) is not in the API; it is checked against the web app constant by hand when it changes.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const SNIPPET = resolve(ROOT, "snippets", "vm-at-a-glance.mdx");
const API = "https://api.rafftechnologies.com/api/v1/public/pricing";
const LICENCE_PER_VCPU = 6;
const LICENCE_MIN_VCPU = 2;

const text = readFileSync(SNIPPET, "utf8").replace(/\\\$/g, "$");

async function get(path) {
  const res = await fetch(`${API}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const onSale = (plans) => plans.filter((p) => !p.out_of_stock && p.monthly_price > 0);
const cheapest = (plans) => onSale(plans).sort((a, b) => a.monthly_price - b.monthly_price)[0];
const money = (n) => `$${n.toFixed(2)}`;
const perGb = (n) => `$${n.toFixed(2)}/GB`;

const [standard, costOptimized, windows, volume, backup] = await Promise.all([
  get("vm?type=standard&region=us-east"),
  get("vm?type=cost_optimized&region=us-east"),
  get("vm?type=windows"),
  get("volume"),
  get("backup"),
]);

const gp = cheapest(standard.plans);
const co = cheapest(costOptimized.plans);
const licence = (vcpu) => LICENCE_PER_VCPU * Math.max(vcpu, LICENCE_MIN_VCPU);
const winStd = onSale(windows.plans)
  .filter((p) => p.local_disk)
  .sort((a, b) => a.monthly_price + licence(a.vcpu) - (b.monthly_price + licence(b.vcpu)))[0];
const linuxFrom = Math.min(gp.monthly_price, co.monthly_price);

const expected = [
  [`Linux entry price`, `From ${money(linuxFrom)}/month`],
  [`General Purpose entry`, `General Purpose ${gp.vcpu} vCPU / ${gp.memory_gib} GB`],
  [`Cost-Optimized entry`, `Cost-Optimized ${co.vcpu} vCPU / ${co.memory_gib} GB`],
  [`Windows entry total`, `From ${money(winStd.monthly_price + licence(winStd.vcpu))}/month with the licence`],
  [`Windows entry size`, `Standard plan ${winStd.vcpu} vCPU / ${winStd.memory_gib} GB`],
  [`Windows entry server price`, `${money(winStd.monthly_price)} for the server`],
  [`Windows entry licence`, `$${licence(winStd.vcpu)} for the licence`],
  [`Volume price`, `Volumes ${perGb(volume.pricing.price_per_gb_month)}`],
  [`Backup price`, `${perGb(backup.pricing.price_per_gb_month)} a month after`],
  [`Yearly term`, Math.abs(gp.yearly_price - gp.monthly_price * 10) < 0.01 ? "the price of 10 months" : `yearly = ${gp.yearly_price}`],
  [
    `24-month term`,
    Math.abs(gp.twenty_four_month_price - gp.monthly_price * 18) < 0.01
      ? "the price of 18 months"
      : `24-month = ${gp.twenty_four_month_price}`,
  ],
];

const missing = expected.filter(([, needle]) => !text.includes(needle));
for (const [label, needle] of expected) {
  console.log(`${missing.some(([l]) => l === label) ? "DRIFT" : "ok   "}  ${label}: ${needle}`);
}
if (missing.length) {
  console.error(`\n${missing.length} fact(s) in snippets/vm-at-a-glance.mdx no longer match the live API.`);
  process.exit(1);
}
