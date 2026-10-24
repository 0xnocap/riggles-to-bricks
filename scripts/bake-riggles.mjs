// Bakes the collection's token hashes into src/data/riggles.json, once, at build
// time, by reading the Riggles API. The site itself never calls the API and ships
// no key: every riggle is redrawn in the visitor's browser from the hash baked in
// here. Hashes are fixed onchain at mint, so this file only needs rebuilding when
// the collection grows.
//
// Usage:  RIGGLES_API_KEY=... node scripts/bake-riggles.mjs
// Get a key at https://api.riggles.xyz/keys (any wallet holding a riggle).
//
// Node built-ins only, no dependencies.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'data', 'riggles.json');

const BASE = process.env.RIGGLES_API_BASE || 'https://api.riggles.xyz/v1';
const KEY = process.env.RIGGLES_API_KEY;
const PAGE = 100;          // the batch route's ceiling
const PAUSE_MS = 400;      // stay well under the per-minute quota
let cap = Number(process.env.RIGGLES_MAX_ID || 10000);   // narrowed by the API's own answer

if (!KEY) {
  console.error('RIGGLES_API_KEY is not set. Issue one at https://api.riggles.xyz/keys and pass it in the environment.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  const res = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + KEY } });
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after') || 30) * 1000;
    console.warn(`  rate limited, waiting ${wait / 1000}s`);
    await sleep(wait);
    return get(path);
  }
  if (!res.ok) {
    const body = await res.text();
    // The API is the authority on the collection's size: when a page runs past the
    // last token it answers "token id must be an integer 1 to N". Take N and stop
    // there rather than hard-coding a supply here.
    const range = /integer\s+\d+\s+to\s+(\d+)/.exec(body);
    if (res.status === 400 && range) return { capAt: Number(range[1]) };
    throw new Error(`${path} answered ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

const riggles = {};
let chainId = null, block = null, empty = 0;

for (let from = 1; from <= cap && empty < 2; from += PAGE) {
  const ids = [];
  for (let i = from; i < from + PAGE && i <= cap; i++) ids.push(i);
  let page = await get('/riggles/batch?ids=' + ids.join(','));
  if (page.capAt) {
    cap = page.capAt;
    const kept = ids.filter((i) => i <= cap);
    if (!kept.length) break;
    page = await get('/riggles/batch?ids=' + kept.join(','));
    ids.length = 0;
    ids.push(...kept);
  }
  chainId ??= page.chainId;
  block = page.block ?? block;
  const items = page.items || [];
  for (const it of items) {
    if (typeof it.id !== 'number' || !/^0x[0-9a-f]{64}$/i.test(it.hash || '')) continue;
    riggles[it.id] = { h: it.hash.toLowerCase(), bg: it.born?.backgroundIndex ?? 0 };
  }
  empty = items.length ? 0 : empty + 1;
  process.stdout.write(`  ${from}-${ids[ids.length - 1]}: ${items.length} riggles\n`);
  if (from + PAGE <= cap) await sleep(PAUSE_MS);
}

const ids = Object.keys(riggles).map(Number).sort((a, b) => a - b);
if (!ids.length) {
  console.error('The API returned no riggles. Nothing written.');
  process.exit(1);
}

const out = {
  note: 'Token hashes of the Riggles collection, read from api.riggles.xyz at build time. Rebuild with: node scripts/bake-riggles.mjs',
  generatedAt: new Date().toISOString(),
  chainId,
  block,
  first: ids[0],
  last: ids[ids.length - 1],
  count: ids.length,
  riggles,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out) + '\n');
console.log(`Wrote ${ids.length} riggles (#${out.first} to #${out.last}) to src/data/riggles.json`);
