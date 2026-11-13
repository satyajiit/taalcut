#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Step 4 of a components release: the manifest sources (compose-provisional.mjs's SOURCES) written from what
 * build.mjs made: each artifact's hosted url, sha256, size and install spec, and `licence.notice`, the hosted
 * NOTICE.txt's url, size and sha256. The `provisional` and `note` fields go (they described files that weren't
 * hosted), and so does the old `licence.url`. Then the union is recomposed. Signing stays a separate step: it
 * needs the next sequence.
 *
 *   node tools/components/hosting/write-manifest.mjs [--release <release.json>] [--pending]
 *
 * --pending writes a pending release (build.mjs --pending) into the PENDING files only.
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PENDING, SOURCES } from '../compose-provisional.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = join(REPO, 'tools', 'components');
/** Fields that described files nobody hosted. */
const DROPPED = new Set(['provisional', 'note']);

/**
 * The licence with the hosted notice in place of the url it had before notices were pinned. Terms the person accepts
 * in the app (`acceptance`, LNX1-TRM) stay as they are.
 */
function licenceWith(licence, notice) {
  const { spdx, attribution, acceptance } = licence;
  return {
    spdx,
    notice: { url: notice.url, size: notice.size, sha256: notice.sha256 },
    ...(attribution ? { attribution } : {}),
    ...(acceptance ? { acceptance } : {}),
  };
}

/** The install spec from release.json, in the manifest's field order. */
function installSpec(install) {
  if (install.type === 'file')
    return { type: 'file', fileName: install.fileName, executable: install.executable };
  return {
    type: 'archive',
    format: install.format,
    stripComponents: install.stripComponents,
    extractedSize: install.extractedSize,
  };
}

/**
 * `manifest` with the released components applied; `changed` lists their ids. `released` maps an id to its record,
 * or to its records, one per platform (they share the component's one notice). Pure.
 */
export function applyRelease(manifest, released) {
  const changed = [];
  const components = manifest.components.map((component) => {
    const found = released.get(component.id);
    if (!found) return component;
    const records = Array.isArray(found) ? found : [found];
    for (const release of records)
      if (release.version !== component.version)
        throw new Error(
          `${component.id}: release.json has version ${release.version}, the manifest ${component.version}`,
        );
    const notices = new Set(records.map((release) => release.notice.sha256));
    if (notices.size > 1) throw new Error(`${component.id}: its records name different notices`);
    changed.push(component.id);
    const rest = Object.fromEntries(Object.entries(component).filter(([key]) => !DROPPED.has(key)));
    return {
      ...rest,
      licence: licenceWith(component.licence, records[0].notice),
      artifacts: component.artifacts.map((artifact) => {
        const release = records.find((record) => record.platform === artifact.platform);
        return !release
          ? artifact
          : {
              platform: artifact.platform,
              urls: [release.url],
              sha256: release.sha256,
              size: release.size,
              install: installSpec(release.install),
            };
      }),
    };
  });
  return { manifest: { ...manifest, components }, changed };
}

/** release.json's records by id, each id's records together. */
export function recordsById(release) {
  const byId = new Map();
  for (const record of release.components) byId.set(record.id, [...(byId.get(record.id) ?? []), record]);
  return byId;
}

/**
 * A pending file's `extend` entries with the released records applied: each one's artifacts by platform, and its
 * licence's notice (the component's one notice, which names the new platform too). Pure.
 */
export function applyExtensions(file, released) {
  const changed = [];
  const extend = Object.fromEntries(
    Object.entries(file.extend ?? {}).map(([id, extension]) => {
      const records = released.get(id);
      if (!records || !extension.artifacts) return [id, extension];
      // The notice is shared across platforms, even when this release changes only the base artifact.
      const applied = applyRelease(
        {
          components: [
            { id, version: records[0].version, licence: extension.licence, artifacts: extension.artifacts },
          ],
        },
        new Map([[id, records]]),
      ).manifest.components[0];
      changed.push(id);
      return [id, { ...extension, licence: applied.licence, artifacts: applied.artifacts }];
    }),
  );
  return { file: { ...file, ...(file.extend ? { extend } : {}) }, changed };
}

/**
 * Writes the released records into the manifest sources, or with `pending` into the PENDING files only (their
 * components and `extend` entries; the shipped sources stay as they are until those files are promoted).
 */
export async function writeManifest(release, { log = console.log, pending = false } = {}) {
  const released = recordsById(release);
  const written = [];
  const seen = new Set();
  for (const name of pending ? PENDING : SOURCES) {
    const path = join(DIR, name);
    const source = JSON.parse(await readFile(path, 'utf8'));
    const extended = applyExtensions(source, released);
    const applied = applyRelease(extended.file, released);
    const manifest = applied.manifest;
    const changed = [...applied.changed, ...extended.changed];
    for (const id of changed) seen.add(id);
    if (changed.length === 0) continue;
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    written.push(path);
    log(`${name}: ${changed.join(', ')}`);
  }
  const missing = [...released.keys()].filter((id) => !seen.has(id));
  if (missing.length > 0 && !pending)
    throw new Error(`in release.json but in no manifest source: ${missing.join(', ')}`);
  if (written.length > 0)
    execFileSync(join(REPO, 'node_modules', '.bin', 'prettier'), ['--write', ...written]);
  execFileSync(process.execPath, [join(DIR, 'compose-provisional.mjs')], { stdio: 'inherit' });
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { release: { type: 'string' }, pending: { type: 'boolean' } } });
  const path = resolve(values.release ?? join(DIR, '.cache', 'release', 'release.json'));
  try {
    await writeManifest(JSON.parse(await readFile(path, 'utf8')), { pending: values.pending ?? false });
  } catch (error) {
    console.error(`write-manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
