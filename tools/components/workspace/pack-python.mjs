// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * workspace-python: python-build-standalone's CPython (the reference fetcher's pin) with the reviewed wheels
 * (pins.mjs WHEELS) installed into it by its own pip, offline and without their dependencies, then pip removed (the
 * shell is offline, and pip vendors certifi's MPL-2.0 bundle). Every module is compiled to bytecode checked by
 * hash, not mtime, so the archive's zeroed mtimes don't make Python recompile on every start in a folder it can't
 * write. LICENSES/ holds CPython's texts for every library PYTHON.json says it links, each wheel's licence files
 * and INVENTORY.txt; a wheel library the review doesn't name, or a copyleft PYTHON.json licence, fails the build.
 */
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { extract } from '../hosting/archive.mjs';
import { listEntries } from '../hosting/files.mjs';
import { pinned } from '../hosting/pinned.mjs';
import { pythonLicences } from '../yt-dlp/inventory.mjs';
import { COPYLEFT } from '../yt-dlp/pins.mjs';
import { finish, onlyDir, run } from './build-common.mjs';
import { PYTHON, VERSIONS, WHEELS } from './pins.mjs';

export const pythonArchiveName = (platform) => `python-${VERSIONS['workspace-python']}-${platform}.tar.zst`;

/** A library's base name (`libpng16.16.dylib` → `libpng16`), as WHEELS' `bundles` name them. */
export const libraryBase = (file) => basename(file).split('.')[0];

/** The libraries in a wheel's .dylibs folders that its review doesn't name. */
export function unreviewedLibraries(entries, wheel) {
  const reviewed = new Set(wheel.bundles);
  return entries
    .filter((path) => /\/\.dylibs\/[^/]+$/.test(path) && /\.dylib$/.test(path))
    .map(libraryBase)
    .filter((base) => !reviewed.has(base));
}

/** INVENTORY.txt: CPython and what it links, then each wheel, with the licence it ships under. */
export function pythonInventory(python, wheels) {
  const lines = [
    `CPython ${PYTHON.version} (python-build-standalone 20261021): ${python.licences.join(' AND ')}; the interpreter and the C libraries its extension modules link (PYTHON.json), texts in LICENSES/python/`,
    ...wheels.map(
      (wheel) =>
        `${wheel.name} ${wheel.version}: ${wheel.spdx}${wheel.bundles.length > 0 ? `; bundles ${wheel.bundles.join(', ')}` : ''}; texts in LICENSES/${wheel.name}-${wheel.version}/`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

export const wheelFile = (wheel) =>
  decodeURIComponent(wheel.pin.url.slice(wheel.pin.url.lastIndexOf('/') + 1));

async function installWheels({ python, root, wheels, work, pinOptions, log }) {
  const dir = join(work, 'wheels');
  await mkdir(dir, { recursive: true });
  const files = [];
  for (const wheel of wheels) {
    const file = join(dir, wheelFile(wheel));
    await copyFile(await pinned(wheel.pin, pinOptions), file);
    files.push(file);
  }
  const env = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: work,
    PIP_CONFIG_FILE: '/dev/null',
    PYTHONNOUSERSITE: '1',
    // Only compileall writes bytecode, with the component's relative names: pip's would name this folder.
    PYTHONDONTWRITEBYTECODE: '1',
    LANG: 'en_US.UTF-8',
  };
  const binBefore = new Set(await readdir(join(root, 'python', 'bin')));
  await run(
    log,
    python,
    [
      '-I',
      '-m',
      'pip',
      'install',
      '--no-index',
      '--no-deps',
      '--no-compile',
      '--no-cache-dir',
      '--disable-pip-version-check',
      '--no-warn-script-location',
      ...files,
    ],
    { env },
  );
  // Console scripts name this build folder in their first line: the shell runs `python3 -m <module>` instead.
  for (const name of await readdir(join(root, 'python', 'bin')))
    if (!binBefore.has(name)) await rm(join(root, 'python', 'bin', name));
  return env;
}

/**
 * pip's record of where each wheel came from (direct_url.json, a file url in this build's scratch folder) goes, and
 * so do the console scripts' lines in RECORD (the scripts are gone, and their hashes named this build's folder): the
 * archive holds no build path, and two builds are the same bytes.
 */
async function forgetWheelFiles(site, wheels) {
  for (const wheel of wheels) {
    const info = join(site, `${wheel.name}-${wheel.version}.dist-info`);
    await rm(join(info, 'direct_url.json'), { force: true });
    const record = join(info, 'RECORD');
    const lines = (await readFile(record, 'utf8')).split('\n');
    const kept = lines.filter(
      (line) => !line.startsWith(`${basename(info)}/direct_url.json,`) && !line.startsWith('../'),
    );
    await writeFile(record, kept.join('\n'));
  }
}

async function removePip(root, site) {
  for (const name of await readdir(site))
    if (/^pip(-|$)/.test(name)) await rm(join(site, name), { recursive: true, force: true });
  for (const name of await readdir(join(root, 'python', 'bin')))
    if (/^pip/.test(name)) await rm(join(root, 'python', 'bin', name));
  await rm(join(root, 'python', 'lib', 'python3.14', 'ensurepip', '_bundled'), {
    recursive: true,
    force: true,
  });
}

async function writeLicences(root, { full, python, wheels, site }) {
  const dir = join(root, 'LICENSES');
  await mkdir(join(dir, 'python'), { recursive: true });
  for (const path of python.paths) await copyFile(join(full, path), join(dir, 'python', basename(path)));
  for (const wheel of wheels) {
    const info = (await readdir(site)).find((name) => name === `${wheel.name}-${wheel.version}.dist-info`);
    if (!info) throw new Error(`${wheel.name} ${wheel.version}: no dist-info after the install`);
    const licences = join(site, info, 'licenses');
    await cp(licences, join(dir, `${wheel.name}-${wheel.version}`), { recursive: true });
  }
  await writeFile(join(dir, 'INVENTORY.txt'), pythonInventory(python, wheels));
}

export async function packPython({ out, platform, identity, pinOptions, log }) {
  const wheels = WHEELS[platform];
  if (!wheels || platform !== 'darwin-arm64') throw new Error(`no Python build for ${platform} yet`);
  await mkdir(out, { recursive: true });
  const work = await realpath(await mkdtemp(join(out, '.work-python-')));
  try {
    const root = join(work, 'component');
    await extract(await pinned(PYTHON.install, pinOptions), 'tar.gz', root);
    await extract(await pinned(PYTHON.full, pinOptions), 'tar.zst', join(work, 'full'));
    const full = await onlyDir(join(work, 'full'));
    const python = pythonLicences(JSON.parse(await readFile(join(full, 'PYTHON.json'), 'utf8')));
    const copyleft = python.licences.filter((licence) => COPYLEFT.test(licence));
    if (copyleft.length > 0) throw new Error(`CPython links libraries under ${copyleft.join(', ')}`);

    const executable = join(root, 'python', 'bin', 'python3');
    const site = join(root, 'python', 'lib', 'python3.14', 'site-packages');
    const env = await installWheels({ python: executable, root, wheels, work, pinOptions, log });
    const entries = await listEntries(site);
    for (const wheel of wheels) {
      const own = entries.filter((path) => path.startsWith(`${wheel.module}/`));
      const extra = unreviewedLibraries(own, wheel);
      if (extra.length > 0)
        throw new Error(`${wheel.name} bundles libraries not reviewed: ${extra.join(', ')}`);
    }
    await forgetWheelFiles(site, wheels);
    await removePip(root, site);
    await writeLicences(root, { full, python, wheels, site });
    await run(
      log,
      executable,
      // -s: the code's file names are relative to the component (Python fixes them up on import).
      [
        '-I',
        '-m',
        'compileall',
        '-q',
        '-f',
        '-j',
        '0',
        '--invalidation-mode',
        'unchecked-hash',
        '-s',
        root,
        join(root, 'python', 'lib'),
      ],
      { env },
    );
    const probe = await run(
      log,
      executable,
      [
        '-I',
        '-c',
        'import sys, numpy, PIL.Image; a = numpy.zeros((4, 4, 3), numpy.uint8); PIL.Image.fromarray(a); print(sys.version.split()[0], numpy.__version__, PIL.__version__)',
      ],
      { env },
    );
    const expected = [PYTHON.version, ...wheels.map((wheel) => wheel.version)].join(' ');
    if (probe.trim() !== expected)
      throw new Error(`the built Python says "${probe.trim()}", not "${expected}"`);
    log(`ran ${relative(root, executable)}: ${probe.trim()}`);
    return await finish({ root, out: join(out, pythonArchiveName(platform)), identity, platform, log });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
