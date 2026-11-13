#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F3: builds the listening models (manifest.listen.provisional.json, hosting/plan/listen.mjs) the way a
 * release does (hosting/build.mjs --pending, the `pack` recipe), into a local release folder outside the
 * repository, and unpacks each build where tests and a development run can load it. See README.md beside this file.
 *
 *   node tools/components/listen/pack-listen-models.mjs [--twice] [--write-manifest] [--only id,id]
 *        [--home <dir>] [--out <dir>] [--cache <dir>] [--models <dir>]
 *
 * --home       default $TAALCUT_EAR1_HOME or ~/.cache/taalcut-ear1; the others default inside it:
 * --cache      <home>/components-cache: the pinned Hugging Face files and the built archives, named by sha256
 * --out        <home>/release: release.json, objects/<id>/<version>/<file> and each NOTICE-<sha>.txt
 *              (TAALCUT_DEV_COMPONENTS=<out> installs them in a development run)
 * --models     <home>/models: each build unpacked as <models>/<id>/ (model.onnx and its configs), as installed
 * --twice      packs everything a second time into <out>-check and fails unless every sha256 is the same
 * --write-manifest  writes the sizes, sha256 and notices into manifest.listen.provisional.json
 *              (hosting/write-manifest.mjs --pending; it recomposes manifest.provisional.json, which Prettier
 *              then puts back as it was: these builds are pending, so the shipped union doesn't change)
 *
 * Every build is packed afresh (build.mjs --rebuild), never taken from the cache, so a run proves the bytes. Nothing
 * is uploaded: hosting is a release step (README.md, "Releasing components"). Node built-ins, tar and zstd 1.5.7.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { extract } from '../hosting/archive.mjs';
import { build } from '../hosting/build.mjs';
import { DEFAULT_IDENTITY } from '../hosting/codesign.mjs';
import { addToCache } from '../hosting/pinned.mjs';
import { LISTEN, LISTEN_TEXT_BANK, LISTEN_TEXTS } from '../hosting/plan/listen.mjs';
import { writeManifest } from '../hosting/write-manifest.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The component ids this script builds, bases before their fp16 variants. */
export const LISTEN_IDS = Object.keys(LISTEN);

/** Where everything goes, from the options and the environment. */
export function locations(values = {}, env = process.env) {
  const home = resolve(values.home ?? env.TAALCUT_EAR1_HOME ?? join(homedir(), '.cache', 'taalcut-ear1'));
  return {
    home,
    cache: resolve(values.cache ?? join(home, 'components-cache')),
    out: resolve(values.out ?? join(home, 'release')),
    models: resolve(values.models ?? join(home, 'models')),
  };
}

/** The ids `--only` names (all of them when absent); an id that isn't a listening model is an error. */
export function chosenIds(only) {
  const named = (only ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  for (const id of named) if (!LISTEN[id]) throw new Error(`not a listening model: ${id}`);
  return named.length > 0 ? named : LISTEN_IDS;
}

/** The release records by id: { version, file, size, sha256, extractedSize, notice }. */
export function summarise(release, ids) {
  return ids.map((id) => {
    const record = release.components.find((c) => c.id === id);
    if (!record) throw new Error(`${id}: not in release.json`);
    return {
      id,
      version: record.version,
      file: record.url.split('/').at(-1),
      size: record.size,
      sha256: record.sha256,
      extractedSize: record.install.extractedSize,
      notice: record.notice.url.split('/').at(-1),
    };
  });
}

/** The ids whose sha256 differs between two summaries, with both values. */
export function differences(first, second) {
  return first.flatMap((one) => {
    const other = second.find((s) => s.id === one.id);
    return other?.sha256 === one.sha256
      ? []
      : [`${one.id}: ${one.sha256} then ${other?.sha256 ?? 'nothing'}`];
  });
}

/**
 * EAR1-F5: the files the audio builds take from the repository (the text-embedding banks, and earshot's licence for
 * their notice) go into the cache under their pinned sha256, so the build finds them there and downloads nothing.
 */
export async function seedRepoFiles(cacheDir, repo = REPO) {
  for (const file of LISTEN_TEXT_BANK) await addToCache(cacheDir, join(repo, file.repo), file.pin);
  await addToCache(cacheDir, join(repo, 'third_party', 'earshot', 'LICENSE'), LISTEN_TEXTS.earshotMit);
}

async function buildAll(ids, out, cacheDir, log) {
  await seedRepoFiles(cacheDir);
  await rm(join(out, 'release.json'), { force: true });
  const release = await build({
    out,
    only: new Set(ids),
    rebuild: new Set(ids),
    identity: DEFAULT_IDENTITY,
    pending: true,
    cacheDir,
    log,
  });
  return { release, summary: summarise(release, ids) };
}

/** Unpacks every build into <models>/<id>/, replacing what was there. */
async function unpack(release, ids, out, models, log) {
  await mkdir(models, { recursive: true });
  for (const id of ids) {
    const record = release.components.find((c) => c.id === id);
    const key = record.url.split('/').slice(-3).join('/');
    const into = join(models, id);
    await rm(into, { recursive: true, force: true });
    await extract(join(out, 'objects', key), record.install.format, into);
    log(`${id}: unpacked into ${into}`);
  }
}

export async function main(argv = process.argv.slice(2), log = console.log) {
  const { values } = parseArgs({
    args: argv,
    options: {
      home: { type: 'string' },
      out: { type: 'string' },
      cache: { type: 'string' },
      models: { type: 'string' },
      only: { type: 'string' },
      twice: { type: 'boolean' },
      'write-manifest': { type: 'boolean' },
    },
  });
  const where = locations(values);
  const ids = chosenIds(values.only);
  log(
    `listening models: ${ids.join(', ')}\n  cache ${where.cache}\n  release ${where.out}\n  models ${where.models}`,
  );
  const first = await buildAll(ids, where.out, where.cache, log);
  if (values.twice) {
    const second = await buildAll(ids, `${where.out}-check`, where.cache, log);
    const differ = differences(first.summary, second.summary);
    if (differ.length > 0) throw new Error(`two packs differ:\n  ${differ.join('\n  ')}`);
    log(`two packs gave the same sha256 for ${ids.length} builds`);
  }
  await unpack(first.release, ids, where.out, where.models, log);
  if (values['write-manifest']) {
    await writeManifest(first.release, { pending: true, log });
    const composed = join(REPO, 'tools', 'components', 'manifest.provisional.json');
    execFileSync(join(REPO, 'node_modules', '.bin', 'prettier'), ['--write', composed]);
  }
  log('\nid\tversion\tfile\tsize\tsha256\textractedSize');
  for (const row of first.summary)
    log(`${row.id}\t${row.version}\t${row.file}\t${row.size}\t${row.sha256}\t${row.extractedSize}`);
  log(
    JSON.stringify({ release: join(where.out, 'release.json'), models: where.models, builds: first.summary }),
  );
  return first.summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`pack-listen-models: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
