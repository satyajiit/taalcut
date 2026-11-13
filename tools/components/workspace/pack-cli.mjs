// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * hyperframes-cli: the HyperFrames CLI with its dependencies, each npm tarball unpacked where
 * hyperframes-cli.lock.json puts it (no npm, no install scripts), and a shim per command in bin/ that runs it on the
 * shell's Node (the workspace-node component, first on the shell's PATH) with lib/taalcut-loopback.cjs preloaded.
 * LICENSES/ holds each package's licence files and INVENTORY.txt; a package without one is listed with the licence
 * its package.json declares.
 */
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from '../hosting/archive.mjs';
import { finish, onlyDir, run } from './build-common.mjs';
import { fetchLocked, licenceAllowed } from './cli-lock.mjs';
import { HYPERFRAMES_CLI, VERSIONS } from './pins.mjs';
import { patchCliEngine } from './patch-cli-engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const cliArchiveName = (platform) =>
  `hyperframes-cli-${VERSIONS['hyperframes-cli']}-${platform}.tar.zst`;

/** Where the component keeps loopback.cjs, which every shim preloads. */
export const LOOPBACK_SHIM = 'lib/taalcut-loopback.cjs';

/**
 * A command's shim: the CLI's own script on whichever `node` is first on PATH, with the shell's loopback ports
 * given to the servers it starts (loopback.cjs).
 */
export function shim(script) {
  return [
    '#!/bin/sh',
    "# The HyperFrames CLI on the workspace shell's Node (Taalcut, AGT2 sbx).",
    'here="$(dirname "$0")"',
    `exec node --require "$here/../${LOOPBACK_SHIM}" "$here/../node_modules/hyperframes/${script}" "$@"`,
    '',
  ].join('\n');
}

/** A package's licence files: LICENSE, LICENCE, COPYING or NOTICE at its root, with any extension. */
export const isLicenceFile = (name) => /^(licen[cs]e|copying|notice)([.-].*)?$/i.test(name);

export function cliInventory(rows) {
  return `${rows
    .map(
      (row) =>
        `${row.name} ${row.version} (${row.path}): ${row.license}; ${row.files.length > 0 ? row.files.map((file) => `LICENSES/${row.name}@${row.version}/${file}`).join(', ') : 'no licence file in the package; its package.json declares the licence above'}`,
    )
    .join('\n')}\n`;
}

async function unpack(file, target, scratch) {
  await rm(scratch, { recursive: true, force: true });
  await extract(file, 'tar.gz', scratch);
  await mkdir(dirname(target), { recursive: true });
  await cp(await onlyDir(scratch), target, { recursive: true, verbatimSymlinks: true });
}

export async function packCli({ out, platform, identity, pinOptions, log }) {
  const lock = JSON.parse(await readFile(join(HERE, HYPERFRAMES_CLI.lock), 'utf8'));
  if (lock.hyperframes !== HYPERFRAMES_CLI.version)
    throw new Error(`hyperframes-cli.lock.json is for ${lock.hyperframes}, not ${HYPERFRAMES_CLI.version}`);
  await mkdir(out, { recursive: true });
  const work = await realpath(await mkdtemp(join(out, '.work-cli-')));
  try {
    const root = join(work, 'component');
    const rows = [];
    for (const { pkg, file } of await fetchLocked(lock, platform, pinOptions)) {
      if (!licenceAllowed(pkg.license)) throw new Error(`${pkg.name}@${pkg.version}: licence ${pkg.license}`);
      const target = join(root, pkg.path);
      await unpack(file, target, join(work, 'unpack'));
      const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
      if (manifest.name !== pkg.name || manifest.version !== pkg.version)
        throw new Error(
          `${pkg.path} holds ${manifest.name}@${manifest.version}, not ${pkg.name}@${pkg.version}`,
        );
      const files = (await readdir(target)).filter(isLicenceFile).sort();
      const into = join(root, 'LICENSES', `${pkg.name}@${pkg.version}`);
      for (const name of files) await cp(join(target, name), join(into, name), { recursive: true });
      rows.push({ ...pkg, files });
    }
    await writeFile(join(root, 'LICENSES', 'INVENTORY.txt'), cliInventory(rows));
    const repo = join(HERE, '..', '..', '..');
    await patchCliEngine({ root, scratch: join(work, 'engine'), repo, pinOptions, log });
    const ownLicences = join(root, 'LICENSES', 'Taalcut');
    await mkdir(ownLicences, { recursive: true });
    await cp(join(repo, 'LICENSE'), join(ownLicences, 'AGPL-3.0-or-later.txt'));
    await cp(join(repo, 'LICENSE-EXCEPTIONS.md'), join(ownLicences, 'ADDITIONAL-PERMISSION.txt'));
    await cp(
      join(repo, 'apps/desktop/packaging/licences/GSAP-standard-license.txt'),
      join(ownLicences, 'GSAP-standard-license.txt'),
    );
    await writeFile(
      join(ownLicences, 'CHANGES.txt'),
      'Modified by Taalcut on 2026-11-11. Upstream HyperFrames remains Apache-2.0.\n' +
        'Taalcut additions are AGPL-3.0-or-later with the accompanying additional permission.\n' +
        'The bundled drawElement service and recoverable paint-timeout handling use the exact app patch,\n' +
        'including the Chrome 155+ canvas API and waiting for the current frame paint.\n' +
        'The loopback preload and command shims are also Taalcut additions.\n' +
        'The upstream CLI also vendors GSAP 3.15.0 unchanged under the separately included GSAP Standard License.\n' +
        'PATCH-PROVENANCE.json records all modified input/output hashes and the scope.\n' +
        `Corresponding source: https://components.taalcut.app/hyperframes-cli/${VERSIONS['hyperframes-cli']}/source/\n`,
    );
    await mkdir(join(root, 'lib'), { recursive: true });
    await cp(join(HERE, 'loopback.cjs'), join(root, LOOPBACK_SHIM));
    await mkdir(join(root, 'bin'), { recursive: true });
    for (const [name, script] of Object.entries(HYPERFRAMES_CLI.bins)) {
      await writeFile(join(root, 'bin', name), shim(script));
      await chmod(join(root, 'bin', name), 0o755);
    }
    const version = (
      await run(
        log,
        process.execPath,
        [join(root, 'node_modules', 'hyperframes', HYPERFRAMES_CLI.bins.hyperframes), '--version'],
        {
          env: { PATH: '/usr/bin:/bin', HOME: work, NO_COLOR: '1' },
        },
      )
    ).trim();
    if (!version.includes(HYPERFRAMES_CLI.version)) throw new Error(`hyperframes --version says ${version}`);
    log(`hyperframes --version: ${version} (${rows.length} packages)`);
    return await finish({ root, out: join(out, cliArchiveName(platform)), identity, platform, log });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
