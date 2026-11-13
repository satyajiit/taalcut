#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Step 1 of a components release (README.md, "Releasing components"): every component in the composed manifest,
 * made from its pinned source by its recipe (plan.mjs), every Mach-O Developer ID-signed and checked, placed at
 * its bucket key with its NOTICE.txt, and listed in release.json for upload.mjs and write-manifest.mjs.
 *
 *   TAALCUT_MAC_IDENTITY="Developer ID Application: …" \
 *   node tools/components/hosting/build.mjs [--out <dir>] [--only id,id] [--rebuild id,id] [--platform p,p] [--pending]
 *
 * --pending adds what compose-provisional.mjs's PENDING files list (not hosted yet) and builds with PENDING_PLAN.
 * --platform builds only those platforms' files (a Linux host: --platform linux-x64); another platform's file is
 * taken from the cache or its hosted url, so the notice still names every artifact. release.json has a record per
 * file: { id, version, platform, url, sha256, size, install, notice, machO }.
 *
 * A component whose manifest file is in the sha256 cache and passes the signing policy is reused byte for byte;
 * anything else is built. Notarisation records (notarize.mjs) for unchanged bytes carry over to the new
 * release.json. --only builds the components it names and keeps the rest of the previous release.json. --rebuild builds even then (its bytes change, so give it a new version first: a hosted
 * key never changes). Default out: tools/components/.cache/release.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { extract } from './archive.mjs';
import { buildComponent } from './build-component.mjs';
import { DEFAULT_IDENTITY } from './codesign.mjs';
import { artifactPlanProblems } from './artifacts.mjs';
import { DEFAULT_CACHE } from './pinned.mjs';
import { compose } from '../compose-provisional.mjs';
import { PENDING_PLAN, PLAN, PUBLIC_BASE } from './plan.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MANIFEST = join(REPO, 'tools', 'components', 'manifest.provisional.json');

const ids = (value) =>
  new Set(
    value
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : [],
  );

/** Every manifest component has a plan and every plan a component: nothing is hosted by accident or left out. */
export function checkCoverage(manifest, plan) {
  const inManifest = manifest.components.map((component) => component.id);
  const missing = inManifest.filter((id) => !plan[id]);
  const extra = Object.keys(plan).filter((id) => !inManifest.includes(id));
  if (missing.length > 0) throw new Error(`no release plan for ${missing.join(', ')}`);
  if (extra.length > 0) throw new Error(`plan entries not in the manifest: ${extra.join(', ')}`);
  const problems = manifest.components.flatMap((component) =>
    artifactPlanProblems(component, plan[component.id]),
  );
  if (problems.length > 0) throw new Error(problems.join('; '));
}

/** Notarisation is a fact about bytes: a rebuild keeps the previous release.json's records for unchanged files. */
function previousNotarisations(previous) {
  const records = (previous?.components ?? [])
    .filter((c) => c.notarisation?.sha256 === c.sha256)
    .map((c) => [c.sha256, c.notarisation]);
  return new Map(records);
}

export async function build({
  out,
  only,
  rebuild,
  identity,
  platforms,
  pending = false,
  log = console.log,
  cacheDir = DEFAULT_CACHE,
}) {
  const manifest = pending
    ? compose(undefined, { pending: true })
    : JSON.parse(await readFile(MANIFEST, 'utf8'));
  const plans = pending ? PENDING_PLAN : PLAN;
  checkCoverage(manifest, plans);
  for (const id of [...only, ...rebuild]) if (!plans[id]) throw new Error(`unknown component ${id}`);
  await mkdir(out, { recursive: true });
  const byId = new Map(manifest.components.map((component) => [component.id, component]));
  const results = new Map();
  const ctx = {
    repo: REPO,
    identity,
    rebuild,
    ...(platforms && platforms.size > 0 ? { platforms } : {}),
    memo: {},
    log,
    pinOptions: { cacheDir, log },
    artifactPath: async (id) => (await one(id)).objects[0].path,
    unpacked: async (id) => {
      const { components, objects } = await one(id);
      const into = join(out, '.unpacked', id);
      await extract(objects[0].path, components[0].install.format, into);
      return into;
    },
  };
  async function one(id) {
    if (!results.has(id)) results.set(id, buildComponent(byId.get(id), plans[id], out, ctx));
    return results.get(id);
  }
  const order = [...byId.keys()];
  // --platform: the components with a file for one of those platforms ('any' among them only when named).
  const onPlatforms = (id) =>
    !platforms || platforms.size === 0 || byId.get(id).artifacts.some((a) => platforms.has(a.platform));
  const chosen = order.filter((id) => (only.size === 0 || only.has(id)) && onPlatforms(id));
  const done = [];
  for (const id of chosen) {
    const result = await one(id);
    for (const record of result.components)
      log(`${id} (${record.platform}): ${record.size} bytes, sha256 ${record.sha256}`);
    done.push(result);
  }
  const previous = await readFile(join(out, 'release.json'), 'utf8').then(JSON.parse, () => undefined);
  const notarised = previousNotarisations(previous);
  const built = new Set(done.flatMap(({ components }) => components.map((component) => component.id)));
  // --only or --platform builds a few: the rest of the previous release stays as it was.
  const partial = only.size > 0 || (platforms?.size ?? 0) > 0;
  const kept = partial && previous ? previous : { components: [], objects: [] };
  const release = {
    base: PUBLIC_BASE,
    components: [
      ...kept.components.filter((c) => !built.has(c.id)),
      ...done.flatMap(({ components }) =>
        components.map((component) => {
          const record = notarised.get(component.sha256);
          return record ? { ...component, notarisation: record } : component;
        }),
      ),
    ].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
    objects: [
      ...kept.objects.filter((o) => !built.has(o.key.split('/')[0])),
      ...done.flatMap((result) => result.objects),
    ].sort((a, b) => order.indexOf(a.key.split('/')[0]) - order.indexOf(b.key.split('/')[0])),
  };
  await writeFile(join(out, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  return release;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      only: { type: 'string' },
      rebuild: { type: 'string' },
      platform: { type: 'string' },
      pending: { type: 'boolean' },
    },
  });
  const out = resolve(values.out ?? join(REPO, 'tools', 'components', '.cache', 'release'));
  const identity = process.env.TAALCUT_MAC_IDENTITY || DEFAULT_IDENTITY;
  try {
    const release = await build({
      out,
      only: ids(values.only),
      rebuild: ids(values.rebuild),
      platforms: ids(values.platform),
      pending: values.pending ?? false,
      identity,
    });
    console.log('\nid\tplatform\tversion\tsize\tsha256\textractedSize');
    for (const c of release.components)
      console.log(
        `${c.id}\t${c.platform}\t${c.version}\t${c.size}\t${c.sha256}\t${c.install.extractedSize ?? '-'}`,
      );
    console.log(`\n${join(out, 'release.json')}: ${release.objects.length} objects`);
  } catch (error) {
    console.error(`build: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
