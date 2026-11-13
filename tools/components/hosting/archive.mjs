// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The components' archive recipe (README.md, "Archives"): names sorted in byte order, files and relative symlinks
 * only, ustar, uid and gid 0, numeric owner, no macOS metadata, executables 0755 and other files 0644, every mtime
 * the epoch, then zstd 1.5.7 on one thread (level 19 unless the recipe explicitly pins another level). macOS's bsdtar 3.5.3 and the zstd CLI; on a Linux host
 * GNU tar with the same recipe, whose bytes differ (a Linux release records its own sha256).
 *
 * Two layouts reproduce the archives already pinned in the manifests byte for byte:
 * - `stream` (vision's packs, pack-*.sh): `tar -cf -` piped into zstd, so the tar ends on bsdtar's 10240-byte
 *   record and the zstd frame carries no content size.
 * - `file` (audio's Beat This!): the tar written to a file with 512-byte blocks, then zstd reads the file, so the
 *   frame records the content size.
 */
import { spawn } from 'node:child_process';
import { chmod, lstat, lutimes, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listEntries, regularBytes } from './files.mjs';

const TAR = '/usr/bin/tar';
const ZSTD = process.env.TAALCUT_ZSTD || 'zstd';
/** macOS's bsdtar. */
const BSD_TAR_FLAGS = [
  '--format',
  'ustar',
  '--uid',
  '0',
  '--gid',
  '0',
  '--numeric-owner',
  '--no-xattrs',
  '--no-mac-metadata',
  '--no-acls',
  '--no-fflags',
];
/** GNU tar (a Linux host, LNX1-CMP): the same recipe in its own words. Its bytes differ from bsdtar's. */
const GNU_TAR_FLAGS = [
  '--format=ustar',
  '--owner=0',
  '--group=0',
  '--numeric-owner',
  '--no-xattrs',
  '--no-acls',
  '--no-selinux',
  '--no-recursion',
];
const TAR_FLAGS = process.platform === 'linux' ? GNU_TAR_FLAGS : BSD_TAR_FLAGS;
const TAR_ENV = { ...process.env, COPYFILE_DISABLE: '1', SOURCE_DATE_EPOCH: '0', LC_ALL: 'C' };

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], ...options });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')}: exit ${code}\n${stderr}`)),
    );
  });
}

/** Sets the recipe's modes and mtimes on `entries` under `root`, in place. */
export async function normalise(root, entries) {
  for (const path of entries) {
    const full = join(root, path);
    const info = await lstat(full);
    if (info.isFile()) await chmod(full, info.mode & 0o111 ? 0o755 : 0o644);
    await lutimes(full, 0, 0);
  }
}

/**
 * Packs `root` (every file and symlink in it, or `entries`) into the tar.zst `out`. Returns the manifest's
 * extractedSize. `root` is changed in place (modes, mtimes), so pass a staging copy.
 */
export async function packTarZst({ root, out, layout, entries, compressionLevel = 19 }) {
  if (layout !== 'stream' && layout !== 'file') throw new Error(`unknown archive layout ${layout}`);
  if (!Number.isInteger(compressionLevel) || compressionLevel < 1 || compressionLevel > 19)
    throw new Error('compressionLevel must be an integer from 1 through 19');
  const names = entries ?? (await listEntries(root));
  if (names.length === 0) throw new Error(`${root}: nothing to pack`);
  await normalise(root, names);
  const work = await mkdtemp(join(tmpdir(), 'taalcut-pack-'));
  try {
    const list = join(work, 'files.txt');
    await writeFile(list, `${names.join('\n')}\n`);
    if (layout === 'file') {
      const tar = join(work, 'archive.tar');
      await run(TAR, [...TAR_FLAGS, '-b', '1', '-cf', tar, '-T', list], { cwd: root, env: TAR_ENV });
      await run(ZSTD, [`-${compressionLevel}`, '-T1', '-q', '-f', tar, '-o', out]);
    } else {
      await streamPack(root, list, out, compressionLevel);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return regularBytes(root, names);
}

function streamPack(root, list, out, compressionLevel) {
  return new Promise((resolve, reject) => {
    const tar = spawn(TAR, [...TAR_FLAGS, '-cf', '-', '-T', list], {
      cwd: root,
      env: TAR_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const zstd = spawn(ZSTD, [`-${compressionLevel}`, '-T1', '-q', '-f', '-o', out], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    tar.stdout.pipe(zstd.stdin);
    let stderr = '';
    for (const child of [tar, zstd]) {
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('error', reject);
    }
    let pending = 2;
    let failed = false;
    const done = (name) => (code) => {
      if (code !== 0 && !failed) {
        failed = true;
        reject(new Error(`${name} exited ${code} packing ${out}\n${stderr}`));
      }
      if (--pending === 0 && !failed) resolve();
    };
    tar.on('close', done('tar'));
    zstd.on('close', done('zstd'));
  });
}

/** Unpacks a component archive (tar, tar.gz or tar.zst) into `into`, which is created. */
export async function extract(archive, format, into) {
  await mkdir(into, { recursive: true });
  if (format === 'tar.zst') {
    const work = await mkdtemp(join(tmpdir(), 'taalcut-unzst-'));
    try {
      const tar = join(work, 'archive.tar');
      await run(ZSTD, ['-d', '-q', '-f', archive, '-o', tar]);
      await run(TAR, ['-xf', tar, '-C', into]);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
    return;
  }
  if (format !== 'tar' && format !== 'tar.gz') throw new Error(`unknown archive format ${format}`);
  await run(TAR, ['-xf', archive, '-C', into]);
}
