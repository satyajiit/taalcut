#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds the `reference-fetcher` component: yt-dlp's PyInstaller onedir from its tagged source (pins.mjs), the way
 * upstream builds its macOS release (bundle/pyinstaller.py, lazy extractors, upstream's hash-locked requirements),
 * on python-build-standalone's CPython, arm64 only. Every Mach-O is signed with the Developer ID (hardened runtime,
 * secure timestamp, no entitlements) and checked, the build is run for real (run-check.mjs), its licences are
 * inventoried (inventory.mjs) into LICENSES/, and it is packed as a tar.zst whose root holds `yt-dlp`, `_internal/`
 * and `LICENSES/`. Prints a JSON summary whose `archive` is the tar.zst.
 *
 *   TAALCUT_MAC_IDENTITY="Developer ID Application: …" node tools/components/yt-dlp/pack.mjs --out <dir>
 */
import { execFile } from 'node:child_process';
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { extract, packTarZst } from '../hosting/archive.mjs';
import { DEFAULT_IDENTITY, signTree, TAALCUT_TEAM, treeProblems } from '../hosting/codesign.mjs';
import { listEntries, sha256File } from '../hosting/files.mjs';
import { DEFAULT_CACHE, pinned } from '../hosting/pinned.mjs';
import { inventory, inventoryText } from './inventory.mjs';
import {
  COPYLEFT,
  COPYLEFT_SOURCES,
  DISTRIBUTIONS,
  PYTHON,
  REQUIREMENTS,
  UPDATE_HINT,
  VARIANT,
  YT_DLP,
} from './pins.mjs';
import { parseLock } from './requirements.mjs';
import { checkBuild } from './run-check.mjs';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const PROFILE = join(REPO, 'packages', 'tools', 'src', 'sandbox', 'profiles', 'fetcher.sb');

/** yt_dlp/version.py with Taalcut's variant and update hint; throws when the file isn't the pinned release's. */
export function taalcutVersionPy(text, version) {
  if (!text.includes(`__version__ = '${version}'`)) throw new Error(`version.py is not ${version}`);
  const out = text
    .replace(/^VARIANT = None$/m, `VARIANT = ${JSON.stringify(VARIANT).replaceAll('"', "'")}`)
    .replace(/^UPDATE_HINT = None$/m, `UPDATE_HINT = ${JSON.stringify(UPDATE_HINT).replaceAll('"', "'")}`);
  if (!out.includes(`VARIANT = '${VARIANT}'`) || !out.includes("UPDATE_HINT = 'This yt-dlp"))
    throw new Error('version.py has no VARIANT = None or UPDATE_HINT = None to set');
  return out;
}

/** Each copyleft source's pinned sha256 must be one of the lock's hashes for that distribution. */
export function checkSourcesAgainstLock(locks, sources = COPYLEFT_SOURCES) {
  const entries = locks.flatMap(parseLock);
  for (const [name, source] of Object.entries(sources)) {
    const entry = entries.find((e) => e.name === name && e.version === source.version);
    if (!entry) throw new Error(`${name} ${source.version} is not in upstream's lock`);
    if (!entry.hashes.includes(source.pin.sha256))
      throw new Error(`${name} ${source.version}: the pinned sdist's sha256 is not in upstream's lock`);
  }
}

/** The bundled copyleft distributions must be exactly the ones whose sources are pinned. */
export function checkCopyleftSet(pieces, sources = COPYLEFT_SOURCES) {
  const bundled = pieces
    .filter((p) => p.copyleft)
    .map((p) => `${p.name.toLowerCase()} ${p.version}`)
    .sort();
  const pinnedSet = Object.entries(sources)
    .map(([n, s]) => `${n} ${s.version}`)
    .sort();
  if (bundled.join() !== pinnedSet.join())
    throw new Error(`copyleft pieces ${bundled.join(', ')} but sources pinned for ${pinnedSet.join(', ')}`);
}

async function run(log, command, args, options = {}) {
  log(`$ ${basename(command)} ${args.join(' ')}`);
  const { stdout } = await exec(command, args, { maxBuffer: 256 * 1024 * 1024, ...options });
  return stdout;
}

async function only(dir) {
  const names = (await readdir(dir)).filter((n) => !n.startsWith('.'));
  if (names.length !== 1) throw new Error(`${dir}: expected one folder, found ${names.join(', ')}`);
  return join(dir, names[0]);
}

async function writeLicences(root, { pieces, pythonFull, source }) {
  const dir = join(root, 'LICENSES');
  await mkdir(dir, { recursive: true });
  await copyFile(join(source, 'LICENSE'), join(dir, 'yt-dlp-LICENSE'));
  await copyFile(join(source, 'THIRD_PARTY_LICENSES.txt'), join(dir, 'yt-dlp-THIRD_PARTY_LICENSES.txt'));
  for (const piece of pieces) {
    for (const file of piece.licenseFiles) {
      const from = piece.name === 'Python' ? join(pythonFull, file) : file;
      const into = join(dir, `${piece.name}-${piece.version}`);
      await mkdir(into, { recursive: true });
      await copyFile(from, join(into, basename(from)));
    }
  }
  const note = `beside this component under source/ (${Object.values(COPYLEFT_SOURCES)
    .map((s) => s.file)
    .join(', ')})`;
  await writeFile(join(dir, 'INVENTORY.txt'), inventoryText(pieces, note));
}

export async function packYtDlp({ out, identity, cacheDir = DEFAULT_CACHE, log = (l) => console.error(l) }) {
  await mkdir(out, { recursive: true });
  const work = await realpath(await mkdtemp(join(out, '.work-')));
  try {
    const pinOptions = { cacheDir, log };
    await extract(await pinned(PYTHON.install, pinOptions), 'tar.gz', join(work, 'python-install'));
    const python = join(await only(join(work, 'python-install')), 'bin', 'python3');
    await extract(await pinned(PYTHON.full, pinOptions), 'tar.zst', join(work, 'python-full'));
    const pythonFull = await only(join(work, 'python-full'));
    await extract(await pinned(YT_DLP.source, pinOptions), 'tar.gz', join(work, 'src'));
    const source = await only(join(work, 'src'));

    const locks = await Promise.all(
      [REQUIREMENTS.pip, ...REQUIREMENTS.bundle].map((f) => readFile(join(source, f), 'utf8')),
    );
    checkSourcesAgainstLock(locks);
    const venv = join(work, 'venv');
    const vpy = join(venv, 'bin', 'python');
    const env = {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: work,
      PIP_CONFIG_FILE: '/dev/null',
      PIP_CACHE_DIR: join(cacheDir, '..', 'pip'),
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
      PYTHONNOUSERSITE: '1',
      LANG: 'en_US.UTF-8',
    };
    await run(log, python, ['-m', 'venv', venv], { env });
    const pip = ['-m', 'pip', 'install', '--index-url', 'https://pypi.org/simple', '--require-hashes'];
    await run(log, vpy, [...pip, '-r', join(source, REQUIREMENTS.pip)], { env });
    await run(
      log,
      vpy,
      [
        ...pip,
        '--only-binary=:all:',
        '--no-deps',
        ...REQUIREMENTS.bundle.flatMap((f) => ['-r', join(source, f)]),
      ],
      { env },
    );

    const versionPy = join(source, 'yt_dlp', 'version.py');
    await writeFile(versionPy, taalcutVersionPy(await readFile(versionPy, 'utf8'), YT_DLP.version));
    await run(log, vpy, ['devscripts/make_lazy_extractors.py'], { cwd: source, env });
    await run(log, vpy, ['-m', 'bundle.pyinstaller', '--onedir', '--name=yt-dlp'], { cwd: source, env });

    const report = JSON.parse(
      await run(log, vpy, [join(HERE, 'inventory.py'), join(source, 'build', 'yt-dlp'), source], { env }),
    );
    const pythonJson = JSON.parse(await readFile(join(pythonFull, 'PYTHON.json'), 'utf8'));
    const { pieces, problems } = inventory(report, pythonJson, {
      ytDlpVersion: YT_DLP.version,
      distributions: DISTRIBUTIONS,
      copyleft: COPYLEFT,
    });
    if (problems.length > 0) throw new Error(`licence inventory:\n  ${problems.join('\n  ')}`);
    checkCopyleftSet(pieces);

    const root = join(work, 'component');
    await cp(join(source, 'dist', 'yt-dlp'), root, { recursive: true, verbatimSymlinks: true });
    await writeLicences(root, { pieces, pythonFull, source });
    const entries = await listEntries(root);
    const signed = await signTree(root, entries, { identity });
    const policy = await treeProblems(root, entries, TAALCUT_TEAM, { entitlements: {} });
    if (policy.problems.length > 0) throw new Error(`signatures:\n  ${policy.problems.join('\n  ')}`);
    for (const path of signed)
      await exec('/usr/bin/codesign', ['--verify', '--strict', '--deep', join(root, path)]);
    log(`signed and verified ${signed.length} Mach-O files`);

    const scratch = join(work, 'run');
    await mkdir(scratch, { recursive: true });
    const ran = await checkBuild({
      componentDir: root,
      version: YT_DLP.version,
      scratch,
      home: await realpath(homedir()),
      profile: PROFILE,
    });
    log(`ran yt-dlp ${ran.version}: --version, a fixture extraction, the same under the fetcher sandbox`);

    const archive = join(out, `yt-dlp-${YT_DLP.version}-darwin-arm64.tar.zst`);
    const extractedSize = await packTarZst({
      root,
      out: archive,
      layout: 'stream',
      entries: await listEntries(root),
    });
    return {
      archive,
      size: (await stat(archive)).size,
      sha256: await sha256File(archive),
      extractedSize,
      machO: signed.length,
      pieces: pieces.map(({ licenseFiles, ...piece }) => ({ ...piece, licenceFiles: licenseFiles.length })),
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) {
    console.error('usage: pack.mjs --out <dir>');
    process.exit(2);
  }
  try {
    const summary = await packYtDlp({
      out: resolve(values.out),
      identity: process.env.TAALCUT_MAC_IDENTITY || DEFAULT_IDENTITY,
    });
    console.log(JSON.stringify({ ...summary, archive: relative(REPO, summary.archive) }, null, 2));
  } catch (error) {
    console.error(`pack yt-dlp: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
