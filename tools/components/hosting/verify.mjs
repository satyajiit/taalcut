#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Step 5 of a components release: every artifact URL in the signed manifest, fetched from the public domain as the
 * app fetches it, against the manifest's size and sha256 (verify-url.mjs), and every component's NOTICE.txt against
 * the size and sha256 its `licence.notice` pins. Every URL must be on the public base: the app depends on
 * Taalcut's domain only. With --sources, the corresponding sources release.json lists are checked the same way.
 *
 *   node tools/components/hosting/verify.mjs [--manifest <signed.json>] [--base <url>] [--only id,id] [--quick]
 *     [--sources <release.json>]
 *
 * --quick checks ranges and headers without downloading whole files. Never run it before an upload: Cloudflare
 * caches a 404 for a few hours.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { contentType } from './objects.mjs';
import { PUBLIC_BASE } from './plan.mjs';
import { checkArtifact, checkNotice } from './verify-url.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** One row per artifact URL (mirrors included), and the problems found before fetching anything. */
export function artifactRows(manifest, base, only) {
  const rows = [];
  for (const component of manifest.components) {
    if (only.size > 0 && !only.has(component.id)) continue;
    for (const artifact of component.artifacts)
      for (const url of artifact.urls)
        rows.push({
          id: component.id,
          url,
          size: artifact.size,
          sha256: artifact.sha256,
          contentType: contentType(new URL(url).pathname),
          offBase: !url.startsWith(`${base}/`),
          notice: component.licence.notice,
        });
  }
  return rows;
}

/** One row per corresponding source in release.json (`<id>/<version>/source/…`), checked like an artifact. */
export function sourceRows(release, base, only) {
  return release.objects
    .filter((object) => object.key.split('/')[2] === 'source')
    .filter((object) => only.size === 0 || only.has(object.key.split('/')[0]))
    .map((object) => ({
      id: object.key.split('/')[0],
      url: `${base}/${object.key}`,
      size: object.size,
      sha256: object.sha256,
      contentType: contentType(object.key),
      offBase: false,
      source: true,
    }));
}

/** The notice an artifact row's component pins: on the base, and served as the pinned bytes. */
async function noticeProblems(row, base, fetch) {
  if (!row.notice?.url?.startsWith(`${base}/`))
    return [`licence notice ${row.notice?.url ?? '(none)'} not on ${base}`];
  return attempt('notice fetch failed', () => checkNotice(row.notice, row.id, { fetch }));
}

/** A network failure is a failed check like any other: recorded, and the run goes on to the next url. */
async function attempt(what, check) {
  try {
    return await check();
  } catch (error) {
    return [`${what}: ${error instanceof Error ? error.message : String(error)}`];
  }
}

export async function verify({
  manifest,
  release,
  base,
  only,
  quick,
  fetch = globalThis.fetch,
  log = console.log,
  concurrency = 3,
}) {
  const rows = [...artifactRows(manifest, base, only), ...(release ? sourceRows(release, base, only) : [])];
  const failures = [];
  let next = 0;
  async function worker() {
    while (next < rows.length) {
      const row = rows[next++];
      const started = Date.now();
      const problems = row.offBase
        ? [`not on ${base}`]
        : await attempt('fetch failed', async () => (await checkArtifact(row, { fetch, quick })).problems);
      if (!row.source) problems.push(...(await noticeProblems(row, base, fetch)));
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const what = row.source ? `${row.id} ${row.url.split('/').at(-1)}` : row.id;
      if (problems.length === 0) log(`ok\t${what}\t${row.size}\t${row.sha256}\t${seconds}s`);
      else {
        failures.push({ ...row, problems });
        log(`FAIL\t${row.id}\t${row.url}\n\t${problems.join('\n\t')}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return { checked: rows.length, failures, bytes: rows.reduce((sum, row) => sum + row.size, 0) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      manifest: { type: 'string' },
      base: { type: 'string' },
      only: { type: 'string' },
      quick: { type: 'boolean' },
      sources: { type: 'string' },
    },
  });
  const path = resolve(values.manifest ?? join(REPO, 'tools', 'components', 'manifest.signed.json'));
  const json = JSON.parse(await readFile(path, 'utf8'));
  const manifest = json.manifest ?? json;
  const only = new Set(values.only ? values.only.split(',').map((id) => id.trim()) : []);
  const base = (values.base ?? PUBLIC_BASE).replace(/\/+$/, '');
  const release = values.sources ? JSON.parse(await readFile(resolve(values.sources), 'utf8')) : undefined;
  const result = await verify({ manifest, release, base, only, quick: values.quick });
  const mode = values.quick ? 'ranges and headers' : 'full download and sha256';
  console.log(`\n${result.checked} urls (${result.bytes} bytes), ${mode}: ${result.failures.length} failed`);
  if (result.failures.length > 0) process.exit(1);
}
