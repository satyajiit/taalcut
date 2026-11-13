#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A development release of the workspace shell's toolchain (AGT2 sbx): each component built by pack.mjs without a
 * Developer ID, placed at its key with the notice the hosting build would write for it (same texts, same layout),
 * and listed in release.json as build.mjs lists a release. A checkout installs from it with
 * TAALCUT_DEV_COMPONENTS=<out>, after write-manifest.mjs --pending has put its sizes and sha256 into
 * manifest.workspace.provisional.json. Never uploaded: nothing in it is signed by Taalcut or notarised, and the
 * hosting build makes the real release from the same pins (hosting/plan/workspace.mjs).
 *
 *   node tools/components/workspace/dev-release.mjs --out <dir> [--only workspace-node,…]
 *   node tools/components/hosting/write-manifest.mjs --pending --release <dir>/release.json
 */
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compose } from '../compose-provisional.mjs';
import { extract } from '../hosting/archive.mjs';
import { listEntries, sha256File, sha256Hex } from '../hosting/files.mjs';
import { noticeText } from '../hosting/notice.mjs';
import { cacheControl, contentType, noticeFile, objectKey, publicUrl } from '../hosting/objects.mjs';
import { DEFAULT_CACHE } from '../hosting/pinned.mjs';
import { PUBLIC_BASE } from '../hosting/plan.mjs';
import { WORKSPACE } from '../hosting/plan/workspace.mjs';
import { PACKERS } from './pack.mjs';

const PLATFORM = 'darwin-arm64';

/** The licence texts a plan's notice quotes from the unpacked archive (build-component.mjs's own two kinds). */
export async function archiveSections(notice, root) {
  const sections = [];
  for (const file of notice.inArtifact ?? [])
    sections.push({ title: file.title, text: await readFile(join(root, file.path), 'utf8') });
  if (notice.inArtifactDir) {
    const prefix = `${notice.inArtifactDir}/`;
    for (const path of (await listEntries(root)).filter((entry) => entry.startsWith(prefix)))
      sections.push({ title: `${path} (from the archive)`, text: await readFile(join(root, path), 'utf8') });
  }
  return sections;
}

async function object(key, path) {
  const { size } = await stat(path);
  return {
    key,
    path,
    size,
    sha256: await sha256File(path),
    contentType: contentType(key),
    cacheControl: cacheControl(key),
  };
}

async function releaseOne(component, plan, out, pinOptions, log) {
  const built = await PACKERS[component.id]({
    out: join(out, '.build'),
    platform: PLATFORM,
    pinOptions,
    log,
  });
  const key = objectKey(component.id, component.version, plan.file);
  const placed = join(out, 'objects', key);
  await mkdir(dirname(placed), { recursive: true });
  await rm(placed, { force: true });
  await copyFile(built.archive, placed);
  await rm(built.archive);
  const unpacked = join(out, '.unpacked', component.id);
  await rm(unpacked, { recursive: true, force: true });
  await extract(placed, 'tar.zst', unpacked);
  const url = publicUrl(PUBLIC_BASE, key);
  const text = noticeText({
    component,
    url,
    changes: plan.notice.changes,
    extra: plan.notice.extra ?? [],
    sections: await archiveSections(plan.notice, unpacked),
  });
  await rm(unpacked, { recursive: true, force: true });
  const noticeKey = objectKey(component.id, component.version, noticeFile(sha256Hex(text)));
  const noticePath = join(out, 'objects', noticeKey);
  await writeFile(noticePath, text);
  const artifact = await object(key, placed);
  const notice = await object(noticeKey, noticePath);
  return {
    record: {
      id: component.id,
      version: component.version,
      platform: PLATFORM,
      url,
      sha256: artifact.sha256,
      size: artifact.size,
      install: { type: 'archive', format: 'tar.zst', stripComponents: 0, extractedSize: built.extractedSize },
      notice: { url: publicUrl(PUBLIC_BASE, noticeKey), size: notice.size, sha256: notice.sha256 },
      machO: built.machO,
      development: true,
    },
    objects: [artifact, notice],
  };
}

export async function devRelease({ out, only, pinOptions, log }) {
  const manifest = compose(undefined, { pending: true });
  const ids = Object.keys(WORKSPACE).filter((id) => only.size === 0 || only.has(id));
  const previous = await readFile(join(out, 'release.json'), 'utf8').then(JSON.parse, () => undefined);
  const release = { base: PUBLIC_BASE, development: true, components: [], objects: [] };
  for (const id of Object.keys(WORKSPACE)) {
    const component = manifest.components.find((each) => each.id === id);
    if (!component) throw new Error(`${id} is not in the pending manifest`);
    if (!ids.includes(id)) {
      release.components.push(...(previous?.components ?? []).filter((c) => c.id === id));
      release.objects.push(...(previous?.objects ?? []).filter((o) => o.key.startsWith(`${id}/`)));
      continue;
    }
    log(`${id}: building`);
    const made = await releaseOne(component, WORKSPACE[id], out, pinOptions, log);
    log(`${id}: ${made.record.size} bytes, sha256 ${made.record.sha256}`);
    release.components.push(made.record);
    release.objects.push(...made.objects);
  }
  await rm(join(out, '.build'), { recursive: true, force: true });
  await writeFile(join(out, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  return release;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, only: { type: 'string' } } });
  if (!values.out) {
    console.error('usage: dev-release.mjs --out <dir> [--only id,id]');
    process.exit(2);
  }
  const log = (line) => console.error(line);
  try {
    const only = new Set(
      (values.only ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const out = resolve(values.out);
    const release = await devRelease({ out, only, pinOptions: { cacheDir: DEFAULT_CACHE, log }, log });
    console.log(
      `${join(out, 'release.json')}: ${release.components.length} components, ${release.objects.length} objects`,
    );
  } catch (error) {
    console.error(`dev-release: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
