// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The HyperFrames CLI's dependency tree (AGT2 sbx): hyperframes-cli.lock.json, every npm package the component
 * installs, by its path in node_modules, with its tarball's url, size and sha256 and its declared licence. Made from
 * an npm package-lock.json (`npm install --package-lock-only --ignore-scripts hyperframes@<version>` in an empty
 * folder) by this file's `refresh`, which downloads each tarball once and checks it against npm's sha512 integrity.
 *
 *   node tools/components/workspace/cli-lock.mjs refresh <package-lock.json>
 *
 * The component never runs npm: pack.mjs unpacks these tarballs where the lock says. Optional dependencies stay out
 * (sharp, whose libvips is LGPL-3.0, among them) except esbuild's own executable for the platform being built.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinned } from '../hosting/pinned.mjs';
import { HYPERFRAMES_CLI } from './pins.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** npm's names for the platforms the components are built for. */
export const NPM_PLATFORMS = {
  'darwin-arm64': { os: 'darwin', cpu: 'arm64' },
  'linux-x64': { os: 'linux', cpu: 'x64' },
};

/** The one optional package a platform keeps: esbuild's executable. */
const keptOptional = ({ os, cpu }) => `@esbuild/${os}-${cpu}`;

/** The licences a CLI package may come under (each one, or every side of an AND). */
export const CLI_LICENCES = ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC0-1.0'];

export const nameOf = (path, entry) => entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 13);

function matches(field, value) {
  if (!field) return true;
  const list = Array.isArray(field) ? field : [field];
  if (list.some((item) => item === `!${value}`)) return false;
  const allowed = list.filter((item) => !item.startsWith('!'));
  return allowed.length === 0 || allowed.includes(value);
}

/** Whether a declared licence passes: one allowed licence, or every side of an AND (an OR needs one side). */
export function licenceAllowed(spdx) {
  if (typeof spdx !== 'string') return false;
  const bare = spdx.trim().replace(/^\((.*)\)$/, '$1');
  if (/ OR /.test(bare)) return bare.split(/ OR /).some((side) => licenceAllowed(side));
  return bare.split(/ AND /).every((side) => CLI_LICENCES.includes(side.trim().replace(/^\((.*)\)$/, '$1')));
}

/**
 * The npm lock's packages a platform installs: every one that isn't optional, and esbuild's executable for it.
 * Dev dependencies never: the lock is of an install, not of a package's own tree.
 */
export function selectPackages(npmLock, platform) {
  const target = NPM_PLATFORMS[platform];
  if (!target) throw new Error(`no npm platform for ${platform}`);
  const chosen = [];
  for (const [path, entry] of Object.entries(npmLock.packages ?? {})) {
    if (path === '' || entry.dev || entry.link) continue;
    const name = nameOf(path, entry);
    if (entry.optional && name !== keptOptional(target)) continue;
    if (!matches(entry.os, target.os) || !matches(entry.cpu, target.cpu)) continue;
    chosen.push({ path, name, entry });
  }
  return chosen.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** sha512 integrity → whether `bytes` are those. */
export function integrityMatches(integrity, bytes) {
  const [algorithm, digest] = String(integrity).split('-', 2);
  if (algorithm !== 'sha512' || !digest) return false;
  return createHash('sha512').update(bytes).digest('base64') === digest;
}

/** The packages a platform installs from the committed lock. */
export function lockedPackages(lock, platform) {
  return lock.packages.filter((pkg) => !pkg.platforms || pkg.platforms.includes(platform));
}

/** Writes hyperframes-cli.lock.json from an npm package-lock.json, downloading each tarball once. */
export async function refresh(npmLockPath, { log = (line) => console.error(line) } = {}) {
  const npmLock = JSON.parse(await readFile(npmLockPath, 'utf8'));
  const root = npmLock.packages?.['node_modules/hyperframes'];
  if (root?.version !== HYPERFRAMES_CLI.version)
    throw new Error(`the npm lock has hyperframes ${root?.version}, not ${HYPERFRAMES_CLI.version}`);
  const byPath = new Map();
  for (const platform of Object.keys(NPM_PLATFORMS))
    for (const { path, name, entry } of selectPackages(npmLock, platform)) {
      const known = byPath.get(path);
      if (known) {
        known.platforms?.push(platform);
        continue;
      }
      byPath.set(path, { path, name, entry, platforms: entry.os || entry.cpu ? [platform] : undefined });
    }
  const packages = [];
  const problems = [];
  for (const { path, name, entry, platforms } of [...byPath.values()].sort((a, b) =>
    a.path < b.path ? -1 : 1,
  )) {
    if (!licenceAllowed(entry.license)) problems.push(`${name}@${entry.version}: licence ${entry.license}`);
    const response = await fetch(entry.resolved);
    if (!response.ok) throw new Error(`${entry.resolved}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!integrityMatches(entry.integrity, bytes))
      throw new Error(`${name}@${entry.version}: the tarball doesn't match npm's integrity`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    log(`${name}@${entry.version} ${bytes.length} ${sha256.slice(0, 12)}`);
    packages.push({
      path,
      name,
      version: entry.version,
      license: entry.license,
      url: entry.resolved,
      size: bytes.length,
      sha256,
      ...(platforms ? { platforms } : {}),
    });
  }
  if (problems.length > 0) throw new Error(`licences to review:\n  ${problems.join('\n  ')}`);
  const lock = {
    $comment:
      'Written by cli-lock.mjs refresh from an npm package-lock.json of hyperframes@' +
      `${HYPERFRAMES_CLI.version}. Every package the hyperframes-cli component unpacks, by its path in node_modules; a package with platforms is installed only on those.`,
    hyperframes: HYPERFRAMES_CLI.version,
    packages,
  };
  await writeFile(join(HERE, HYPERFRAMES_CLI.lock), `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}

/** Each locked tarball's path in the sha256 cache (downloaded when missing). */
export async function fetchLocked(lock, platform, pinOptions) {
  const files = [];
  for (const pkg of lockedPackages(lock, platform))
    files.push({ pkg, file: await pinned({ url: pkg.url, size: pkg.size, sha256: pkg.sha256 }, pinOptions) });
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, path] = process.argv.slice(2);
  if (command !== 'refresh' || !path) {
    console.error('usage: cli-lock.mjs refresh <package-lock.json>');
    process.exit(2);
  }
  try {
    const lock = await refresh(path);
    console.log(`${lock.packages.length} packages`);
  } catch (error) {
    console.error(`cli-lock: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
