#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Step 2 of a components release: every object build.mjs listed in release.json, into the R2 bucket through its
 * S3 API (upload-object.mjs). Only the bucket the env file names is touched, and only to add objects: no key is
 * ever overwritten. Credentials: ~/.config/taalcut/r2-components.env (credentials.mjs).
 *
 *   node tools/components/hosting/upload.mjs [--release <release.json>] [--only id,id] [--dry-run]
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadR2Config } from './credentials.mjs';
import { notarisationProblems } from './notarize.mjs';
import { r2Client } from './r2.mjs';
import { uploadObject } from './upload-object.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The objects of the components named in `only` (all when it's empty). */
export function selectObjects(release, only) {
  if (only.size === 0) return release.objects;
  const unknown = [...only].filter((id) => !release.components.some((c) => c.id === id));
  if (unknown.length > 0) throw new Error(`not in release.json: ${unknown.join(', ')}`);
  return release.objects.filter((object) => only.has(object.key.split('/')[0]));
}

/** Uploads the release's objects; refuses one whose Taalcut-signed components aren't all notarised. */
export async function upload({ release, only, dryRun, client, publicBase, plan, log = console.log }) {
  if (publicBase.replace(/\/+$/, '') !== release.base)
    throw new Error(`release.json is for ${release.base}, the bucket serves ${publicBase}`);
  const unnotarised = notarisationProblems(release, { only, ...(plan ? { plan } : {}) });
  if (unnotarised.length > 0 && !dryRun) throw new Error(unnotarised.join('; '));
  const results = [];
  for (const object of selectObjects(release, only)) {
    if (dryRun) {
      const head = await client.head(object.key);
      results.push({
        key: object.key,
        size: object.size,
        result: head ? `present (${head.sha256})` : 'to upload',
      });
    } else {
      results.push({
        key: object.key,
        size: object.size,
        result: await uploadObject(client, object, { log }),
      });
    }
    log(`${results.at(-1).result}\t${object.size}\t${object.key}`);
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { release: { type: 'string' }, only: { type: 'string' }, 'dry-run': { type: 'boolean' } },
  });
  const releasePath = resolve(
    values.release ?? join(REPO, 'tools', 'components', '.cache', 'release', 'release.json'),
  );
  const only = new Set(values.only ? values.only.split(',').map((id) => id.trim()) : []);
  try {
    const release = JSON.parse(await readFile(releasePath, 'utf8'));
    const config = await loadR2Config();
    const client = r2Client(config);
    const results = await upload({
      release,
      only,
      dryRun: values['dry-run'],
      client,
      publicBase: config.publicBase,
    });
    const bytes = results.reduce((sum, r) => sum + r.size, 0);
    console.log(`\n${results.length} objects, ${bytes} bytes, bucket ${config.bucket}`);
  } catch (error) {
    console.error(`upload: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
