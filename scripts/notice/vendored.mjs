// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compareText } from './format.mjs';

/** Same sentences scripts/licence-scan.mjs used to inline. Tests match these words. */
export const REACT_BITS_BODY =
  'Used from `third_party/react-bits/` under the upstream licence fetched from `DavidHDev/react-bits` commit `e2eb04d89d5be5a633dba7b2d4adfd274e053767` (LICENSE.md, "MIT + Commons Clause License Condition v1.0", copyright David Haz). Not an npm dependency. Used inside the app, never redistributed as a standalone kit. See `third_party/react-bits/README.md`.';

export const PAGE_MASCOT_BODY =
  "The Mascot component, used from `third_party/page-mascot/` under the upstream licence fetched from `nilbuild/page-mascot` commit `76a44ed9180063bf4852b9dd724b656f4a828ac7` (LICENSE, MIT, copyright (c) 2026 Kamran Ahmed). Not an npm dependency. It is the sprite stage of Kaatu, Taalcut's mascot, whose sprite sheets and player were made for Taalcut and are not part of page-mascot. See `third_party/page-mascot/README.md`.";

export const FLUID_AUDIO_BODY =
  'FluidAudio 0.17.7 (https://github.com/FluidInference/FluidAudio, Apache-2.0) is linked into the macOS helper for Parakeet TDT v3 speech recognition only. Pin revision 503b4bd1bbf7220882de39fe8ae6716aae4132da. The NemoTextProcessing trait is off, and the helper does not call text-to-speech. License text: native/mac-helper/LICENSES/FluidAudio-Apache-2.0.txt. The Parakeet weights are a separate component.';

const FLUID_REVISION = '503b4bd1bbf7220882de39fe8ae6716aae4132da';

/** LIB1-PLACE: the GeoNames places the app ships, as packages/library/data/places.lock.json pins them. */
const GEONAMES_DATA = 'packages/library/data';

/**
 * CC BY 4.0's credit for the place names: the source and its site, the licence's name and link, and what Taalcut
 * changed. The date and the count come from the lock file, so the notice follows a rebuilt dataset.
 */
export function geonamesBody(lock) {
  return `Place names from GeoNames (https://www.geonames.org/), licensed under the Creative Commons Attribution 4.0 International licence (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/). Taalcut ships a subset of GeoNames' cities1000, admin1CodesASCII and countryInfo as of ${lock.sourceDate}, re-encoded for Taalcut into ${GEONAMES_DATA}/${lock.file} (${lock.cities} places) by packages/library/scripts/build-places.ts: it keeps each place's id, name, coordinates, population, country, first-level region and time zone, and leaves out sections of cities and historical, abandoned or destroyed places. GeoNames' data comes with no warranty. See ${GEONAMES_DATA}/GEONAMES-NOTICE.txt.`;
}

/** The GeoNames block, from the lock file; its notice must be there and name the licence. */
export function geonamesBlock(repoRoot) {
  const lock = JSON.parse(readFileSync(join(repoRoot, GEONAMES_DATA, 'places.lock.json'), 'utf8'));
  if (lock.licence !== 'CC-BY-4.0')
    throw new Error(`places.lock.json names licence ${lock.licence}, not CC-BY-4.0`);
  if (!existsSync(join(repoRoot, GEONAMES_DATA, lock.file)))
    throw new Error(`${GEONAMES_DATA}/${lock.file} is missing`);
  const notice = readFileSync(join(repoRoot, GEONAMES_DATA, 'GEONAMES-NOTICE.txt'), 'utf8');
  if (!notice.includes('CC BY 4.0') || !notice.includes('geonames.org'))
    throw new Error('GEONAMES-NOTICE.txt no longer credits GeoNames under CC BY 4.0');
  return { heading: 'GeoNames', body: geonamesBody(lock) };
}

/** HFW1: HyperFrames' agent skill, bundled as the Designer's reference (workspace.docs), as its lock pins it. */
const HYPERFRAMES_DOCS = 'packages/render/src/workspace/docs';
/** The licences the bundled skills may come under (the round's rule: Apache-2.0 or MIT). */
const HYPERFRAMES_DOCS_LICENCES = ['Apache-2.0', 'MIT'];

export function hyperframesDocsBody(lock) {
  return `HyperFrames' agent skill (the hyperframes skill's Markdown: SKILL.md and its references, ${lock.files.length} files) from ${lock.repo} at ${lock.tag} (commit \`${lock.commit}\`), licensed under ${lock.licence}, copyright 2026 HeyGen, Inc. Bundled unmodified in ${HYPERFRAMES_DOCS}/skills as reference documents the Designer reads (workspace.docs); its preset designs, fonts and scripts are not included. License text: ${HYPERFRAMES_DOCS}/LICENSE.`;
}

/** The HyperFrames skills block, from their lock; its licence must be allowed and its text there. */
export function hyperframesDocsBlock(repoRoot) {
  const lock = JSON.parse(readFileSync(join(repoRoot, HYPERFRAMES_DOCS, 'docs.lock.json'), 'utf8'));
  if (!HYPERFRAMES_DOCS_LICENCES.includes(lock.licence))
    throw new Error(`The HyperFrames skills are under ${lock.licence}, not Apache-2.0 or MIT`);
  if (!/^[0-9a-f]{40}$/.test(lock.commit)) throw new Error('docs.lock.json pins no commit');
  const licence = readFileSync(join(repoRoot, HYPERFRAMES_DOCS, 'LICENSE'), 'utf8');
  if (lock.licence === 'Apache-2.0' && !licence.includes('Apache License'))
    throw new Error(`${HYPERFRAMES_DOCS}/LICENSE is not the Apache-2.0 text`);
  return { heading: 'HyperFrames agent skills', body: hyperframesDocsBody(lock) };
}

/** AGT2 sbx: Codex's Seatbelt base policy, the first block of the workspace shell's profile. */
const PROFILES = 'packages/tools/src/sandbox/profiles';
const CODEX_COMMIT = '696b4502dfaacd91133c3691a23dc91ae3b14bc9';
const CODEX_POLICY_SHA256 = '5103332ddb8885ee5e1926de6c0ef23a61f4e55e31297506ae05fa4e0b24ba74';

export const CODEX_SEATBELT_BODY = `Codex's Seatbelt base policy (codex-rs/sandboxing/src/seatbelt_base_policy.sbpl from https://github.com/openai/codex, commit \`${CODEX_COMMIT}\`, Apache-2.0, copyright 2025 OpenAI; NOTICE: "OpenAI Codex, Copyright 2025 OpenAI") is the first block of ${PROFILES}/workspace.sb, the workspace shell's Seatbelt profile, unmodified (sha256 ${CODEX_POLICY_SHA256}); Taalcut's own rules follow it. License text: ${PROFILES}/LICENSES/Codex-Apache-2.0.txt.`;

/** The Codex block, when workspace.sb still holds the pinned policy unchanged and its licence text is there. */
export function codexSeatbeltBlock(repoRoot) {
  const profile = readFileSync(join(repoRoot, PROFILES, 'workspace.sb'), 'utf8');
  const found = profile.match(
    /; ---- Codex's seatbelt_base_policy\.sbpl \(Apache-2\.0\) ----\n([\s\S]*?); ---- end of Codex's base policy ----\n/,
  );
  if (!found) throw new Error('workspace.sb no longer marks the Codex base policy');
  // Upstream opens with `(version 1)` and a blank line; the profile keeps that line above its own header comment.
  const upstream = `(version 1)\n\n${found[1]}`;
  if (createHash('sha256').update(upstream).digest('hex') !== CODEX_POLICY_SHA256)
    throw new Error(
      'workspace.sb changed the Codex base policy: re-pin it, and say what changed (Apache-2.0 4(b))',
    );
  if (!profile.includes('Portions Copyright 2025 OpenAI'))
    throw new Error('workspace.sb lost its Codex copyright line');
  const licence = readFileSync(join(repoRoot, PROFILES, 'LICENSES', 'Codex-Apache-2.0.txt'), 'utf8');
  if (
    !licence.includes('Apache License') ||
    !licence.includes('Copyright 2025 OpenAI') ||
    !licence.includes(CODEX_COMMIT)
  )
    throw new Error(`${PROFILES}/LICENSES/Codex-Apache-2.0.txt is not Codex's Apache-2.0 text at the pin`);
  return { heading: 'Codex Seatbelt base policy', body: CODEX_SEATBELT_BODY };
}

const LICENCE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENCE.txt'];

const KNOWN = [
  {
    dir: 'react-bits',
    heading: 'React Bits',
    body: REACT_BITS_BODY,
    commit: 'e2eb04d89d5be5a633dba7b2d4adfd274e053767',
    licenceIncludes: ['David Haz', 'Commons Clause'],
    readmeIncludes: 'not redistributed as a standalone component kit',
  },
  {
    dir: 'page-mascot',
    heading: 'page-mascot',
    body: PAGE_MASCOT_BODY,
    commit: '76a44ed9180063bf4852b9dd724b656f4a828ac7',
    licenceIncludes: ['Kamran Ahmed'],
    readmeIncludes: 'not an npm dependency',
  },
];

function findLicence(dir) {
  for (const name of LICENCE_NAMES) {
    const path = join(dir, name);
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

function readLicence(dir, label) {
  const path = findLicence(dir);
  if (!path) throw new Error(`${label} has no LICENCE or LICENSE file`);
  const text = readFileSync(path, 'utf8');
  if (text.trim() === '') throw new Error(`${label} licence file is empty`);
  return text;
}

/**
 * FluidAudio is a native helper dependency, not an npm package and not under
 * third_party. The paragraph stays the one already in NOTICE. Other native
 * deps are not invented here.
 */
export function assertFluidAudio(repoRoot) {
  const licence = readFileSync(
    join(repoRoot, 'native/mac-helper/LICENSES/FluidAudio-Apache-2.0.txt'),
    'utf8',
  );
  if (!licence.includes('Apache'))
    throw new Error('FluidAudio licence file does not look like the Apache text');
  const pkg = readFileSync(join(repoRoot, 'native/mac-helper/Package.swift'), 'utf8');
  if (!pkg.includes('exact: "0.17.7"')) throw new Error('Package.swift does not pin FluidAudio 0.17.7');
  const resolved = readFileSync(join(repoRoot, 'native/mac-helper/Package.resolved'), 'utf8');
  if (!resolved.includes(FLUID_REVISION))
    throw new Error('Package.resolved does not pin the FluidAudio revision');
}

function knownBlock(thirdPartyDir, vendor) {
  const dir = join(thirdPartyDir, vendor.dir);
  const licence = readLicence(dir, `third_party/${vendor.dir}`);
  for (const needle of vendor.licenceIncludes) {
    if (!licence.includes(needle)) {
      throw new Error(`third_party/${vendor.dir} licence file does not contain ${needle}`);
    }
  }
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  if (!readme.includes(vendor.commit)) {
    throw new Error(`third_party/${vendor.dir}/README.md does not pin ${vendor.commit}`);
  }
  if (!readme.includes(vendor.readmeIncludes)) {
    throw new Error(`third_party/${vendor.dir}/README.md no longer says "${vendor.readmeIncludes}"`);
  }
  return { heading: vendor.heading, body: vendor.body };
}

function extraBlock(thirdPartyDir, name) {
  const label = `third_party/${name}`;
  const licence = readLicence(join(thirdPartyDir, name), label);
  const readmePath = join(thirdPartyDir, name, 'README.md');
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
  const commit = readme.match(/`([0-9a-f]{40})`/);
  const copyright = licence.match(/Copyright[^\n]+/);
  const title =
    licence
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? '';
  const pin = commit ? `Commit \`${commit[1]}\`.` : 'No commit pin in the README.';
  const credit = copyright ? copyright[0] : 'No copyright line in the licence file.';
  return {
    heading: name,
    body: `${label}. ${title} ${credit} ${pin} See \`${label}/README.md\`.`,
  };
}

export function loadVendored(thirdPartyDir, repoRoot) {
  assertFluidAudio(repoRoot);
  const blocks = KNOWN.map((vendor) => knownBlock(thirdPartyDir, vendor));
  const knownDirs = new Set(KNOWN.map((vendor) => vendor.dir));
  const extras = readdirSync(thirdPartyDir)
    .filter((name) => !knownDirs.has(name) && statSync(join(thirdPartyDir, name)).isDirectory())
    .sort(compareText);
  for (const name of extras) blocks.push(extraBlock(thirdPartyDir, name));
  blocks.push({ heading: 'FluidAudio', body: FLUID_AUDIO_BODY });
  blocks.push(geonamesBlock(repoRoot));
  blocks.push(hyperframesDocsBlock(repoRoot));
  blocks.push(codexSeatbeltBlock(repoRoot));
  return blocks;
}
