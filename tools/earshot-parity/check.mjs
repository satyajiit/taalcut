#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Validate the earshot parity fixtures (EAR1-F2): the manifest's shape and pins, every fixture file's sha256 and
 * schema, every float32 array's slice hash, the clip set's make-up and planted truth, the size budget, and every
 * generated clip regenerated to the sha256 upstream analysed. Exit 1 on any problem.
 *
 *   node tools/earshot-parity/check.mjs [--no-clips]
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { ALL, clipSpec, renderClip } from './gen/catalogue.mjs';
import { encodeWav } from './gen/wav.mjs';

const ROOT = join(import.meta.dirname, 'fixtures');
const COMMIT = 'ff41f0788ae56896fd59879ab03858d223c06a53';
const MODELS = {
  clap: ['laion/larger_clap_general', '16c8cc3159a3c8a31e8ff5ef1f66b0d9ab3667db'],
  ast: ['MIT/ast-finetuned-audioset-10-10-0.4593', 'f826b80d28226b62986cc218e5cec390b1096902'],
};
const BUDGET = { target: 2_000_000, max: 6_000_000 };
const MINIMUM = { music: 10, sfx: 10, speech: 5, edge: 5 };
const COMMANDS = {
  describe: 'describe',
  measure: 'measure',
  realness: 'realness',
  match: 'match',
  rank: 'rank',
  find: 'find',
  compare: 'compare',
  ab: 'ab',
  timeline: 'timeline',
  critique: 'critique',
  'sfx-check': 'sfx',
  'sfx-render': 'sfx',
};
const INTERMEDIATES = [
  'text',
  'clap-audio',
  'borderline',
  'clap-features',
  'ast',
  'onsets',
  'beats',
  'sections',
  'realness',
];

const { values } = parseArgs({ options: { 'no-clips': { type: 'boolean', default: false } } });
const problems = [];
const fail = (msg) => problems.push(msg);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const read = (rel) => readFileSync(join(ROOT, rel));
const json = (rel) => JSON.parse(read(rel).toString('utf8'));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [relative(ROOT, path).split('\\').join('/')];
  });
}

const manifest = json('manifest.json');

// 1. Pins.
if (manifest.schema !== 1) fail('manifest.schema is not 1');
if (manifest.upstream?.commit !== COMMIT)
  fail(`upstream commit is ${manifest.upstream?.commit}, not ${COMMIT}`);
for (const [name, [id, rev]] of Object.entries(MODELS)) {
  const m = manifest.models?.[name];
  if (m?.id !== id || m?.revision !== rev) fail(`model ${name} is ${m?.id}@${m?.revision}, not ${id}@${rev}`);
  if (m?.precision !== 'fp32') fail(`model ${name} ran in ${m?.precision}, not fp32`);
}
if (manifest.settings?.EARSHOT_PRECISION !== 'fp32') fail('EARSHOT_PRECISION was not fp32');
for (const key of ['python', 'torch', 'transformers', 'numpy', 'scipy'])
  if (!manifest.versions?.[key]) fail(`versions.${key} is missing`);

// 2. Files: every listed file matches, nothing unlisted, within budget.
const files = manifest.files ?? {};
const onDisk = walk(ROOT).filter(
  (rel) => rel !== 'manifest.json' && !rel.split('/').some((p) => p.startsWith('.')),
);
for (const rel of onDisk) if (!files[rel]) fail(`${rel} is not in the manifest`);
let total = 0;
for (const [rel, entry] of Object.entries(files)) {
  let bytes;
  try {
    bytes = read(rel);
  } catch {
    fail(`${rel} is missing`);
    continue;
  }
  total += bytes.length;
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256)
    fail(`${rel} does not match its sha256`);
}
total += read('manifest.json').length;
if (total > BUDGET.max)
  fail(`fixtures are ${(total / 1e6).toFixed(2)} MB, over the ${BUDGET.max / 1e6} MB cap`);

// 3. Clips: make-up, provenance, truth.
const rows = manifest.clips ?? [];
const count = (cat) => rows.filter((r) => r.category === cat).length;
for (const [cat, n] of Object.entries(MINIMUM))
  if (count(cat) < n) fail(`${count(cat)} ${cat} clips, need ${n}`);
if (rows.filter((r) => r.category !== 'film').length < 40) fail('fewer than 40 clips besides the films');
for (const r of rows) {
  if (!['generated', 'earshot sfx render'].includes(r.source))
    fail(`${r.id}: source ${r.source} is not allowed`);
  if (r.sampleRate !== 48000) fail(`${r.id}: ${r.sampleRate} Hz`);
  if (!ALL.some((c) => c.id === r.id)) fail(`${r.id} is not in gen/catalogue.mjs`);
  if (r.committed && files[r.committed]?.sha256 !== r.sha256) fail(`${r.id}: committed file hash differs`);
}
const films = rows.filter((r) => r.category === 'film');
if (films.length < 1) fail('no fixture film');
for (const f of films) {
  const plants = f.truth?.plants ?? [];
  if ((f.truth?.cuts ?? []).length < 30) fail(`${f.id}: fewer than 30 cuts`);
  if (plants.length !== f.truth?.cuts?.length) fail(`${f.id}: not one plant per cut`);
}
const kinds = new Set((films[0]?.truth?.plants ?? []).map((p) => p.plant));
for (const k of ['on', 'late20', 'late60', 'late120', 'late180', 'early80', 'swell', 'swell200', 'none'])
  if (!kinds.has(k)) fail(`film-00 has no "${k}" plant`);

// 4. CLI fixtures: { runId: { argv, exit, result } }.
for (const [name, first] of Object.entries(COMMANDS)) {
  const rel = `cli/${name}.json`;
  if (!files[rel]) {
    fail(`${rel} is missing`);
    continue;
  }
  const runs = json(rel);
  if (!isObj(runs) || Object.keys(runs).length === 0) fail(`${rel} has no runs`);
  for (const [id, run] of Object.entries(runs)) {
    if (!Array.isArray(run.argv) || run.argv[0] !== first)
      fail(`${rel} ${id}: argv does not start with ${first}`);
    if (!isObj(run.result)) fail(`${rel} ${id}: no result`);
    if (name !== 'sfx-check' && name !== 'sfx-render' && run.exit !== 0 && !run.result?.error)
      fail(`${rel} ${id}: exit ${run.exit} without an error`);
  }
}
checkResults();

// 5. Kits.
for (const preset of ['calm', 'crisp', 'minimal', 'launch']) {
  const lock = files[`kits/${preset}/kit.lock.json`] ? json(`kits/${preset}/kit.lock.json`) : null;
  if (!files[`kits/${preset}/kit.json`] || !lock) {
    fail(`kit ${preset} is missing`);
    continue;
  }
  const takes = Object.values(lock.roles ?? {}).flatMap((r) => r?.takes ?? []);
  if (takes.length === 0) fail(`kit ${preset} has no takes`);
  for (const t of takes)
    if (![t.onset_s, t.peak_s, t.end_s].every(Number.isFinite))
      fail(`kit ${preset} ${t.file}: no onset/peak/end`);
}

// 6. Float32 arrays and JSON intermediates.
const index = files['intermediates/index.json']
  ? json('intermediates/index.json')
  : { arrays: {}, files: {} };
const blobFiles = new Map();
for (const [key, info] of Object.entries(index.arrays ?? {})) {
  if (!blobFiles.has(info.file))
    blobFiles.set(info.file, files[`intermediates/${info.file}`] ? read(`intermediates/${info.file}`) : null);
  const buf = blobFiles.get(info.file);
  const size = info.shape.reduce((a, b) => a * b, 1);
  if (!buf || (info.offset + size) * 4 > buf.length) {
    fail(`array ${key} lies outside ${info.file}`);
    continue;
  }
  if (sha256(buf.subarray(info.offset * 4, (info.offset + size) * 4)) !== info.sha256)
    fail(`array ${key}: sha256`);
}
for (const [file, info] of Object.entries(index.files ?? {}))
  if (blobFiles.get(file)?.length !== info.floats * 4) fail(`${file}: ${info.floats} floats listed`);
for (const name of INTERMEDIATES)
  if (!files[`intermediates/${name}.json`]) fail(`intermediates/${name}.json missing`);
for (const key of ['clap-text/vocab', 'clap-text/queries'])
  if (!index.arrays?.[key]) fail(`array ${key} missing`);
if (index.arrays?.['clap-text/vocab']?.shape?.join('x') !== '322x512')
  fail('vocabulary embeddings are not 322x512');
for (const r of rows) {
  if (!index.arrays?.[`clap-audio/${r.id}`]) fail(`no pooled CLAP embedding for ${r.id}`);
  if (!index.arrays?.[`clap-audio-windows/${r.id}`]) fail(`no CLAP window embeddings for ${r.id}`);
}

// 7. Regenerate every generated clip.
let regenerated = 0;
if (!values['no-clips']) {
  for (const r of rows) {
    if (r.source !== 'generated') continue;
    const out = renderClip(clipSpec(r.id));
    const bytes = encodeWav({ sampleRate: out.sampleRate, channels: out.channels, format: 'f32' });
    if (sha256(bytes) !== r.sha256)
      fail(`${r.id}: regenerated clip does not match the sha256 upstream analysed`);
    regenerated += 1;
  }
}

function checkResults() {
  const res = (name) => (files[`cli/${name}.json`] ? json(`cli/${name}.json`) : {});
  for (const [id, run] of Object.entries(res('describe')))
    if (typeof run.result.summary !== 'string') fail(`describe ${id}: no summary`);
  for (const [id, run] of Object.entries(res('timeline')))
    for (const key of ['events', 'sections', 'loudness', 'music'])
      if (!(key in run.result)) fail(`timeline ${id}: no ${key}`);
  for (const f of films) {
    const t = res('timeline')[f.id]?.result;
    if (!t?.sync?.cuts?.items?.length) fail(`timeline ${f.id}: no cut sync`);
    const c = res('critique')[f.id]?.result;
    if (!Array.isArray(c?.metrics) || typeof c?.verdict !== 'string') fail(`critique ${f.id}: no scorecard`);
  }
  for (const [id, run] of Object.entries(res('match')))
    if (!Array.isArray(run.result.results) && !run.result.error) fail(`match ${id}: no results`);
}

const size = `${(total / 1e6).toFixed(2)} MB${total > BUDGET.target ? ` (over the ${BUDGET.target / 1e6} MB target)` : ''}`;
if (problems.length > 0) {
  console.error(`earshot parity fixtures: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `earshot parity fixtures OK: ${rows.length} clips (${films.length} films), ${Object.keys(files).length} files, ` +
    `${Object.keys(index.arrays ?? {}).length} arrays, ${size}` +
    (values['no-clips'] ? '; clips not regenerated' : `; ${regenerated} clips regenerated`),
);
