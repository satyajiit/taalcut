#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Package the exact Swift package sources, including recursively pinned submodules, used by the MLX build. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { packTarZst } from './hosting/archive.mjs';
import { loadR2Config } from './hosting/credentials.mjs';
import { listEntries, sha256File } from './hosting/files.mjs';
import { IMMUTABLE, contentType, publicUrl } from './hosting/objects.mjs';
import { PUBLIC_BASE } from './hosting/plan.mjs';
import { r2Client } from './hosting/r2.mjs';
import { uploadObject } from './hosting/upload-object.mjs';

const exec = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = async (cwd, args) => (await exec('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 })).stdout;

export function packagePins(resolved) {
  const seen = new Set();
  return resolved.pins.map((pin) => {
    if (
      !/^[a-z0-9][a-z0-9-]*$/.test(pin.identity) ||
      !/^[0-9a-f]{40}$/.test(pin.state.revision) ||
      !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(pin.location) ||
      seen.has(pin.identity)
    )
      throw new Error('invalid or duplicate Swift dependency pin');
    seen.add(pin.identity);
    return {
      identity: pin.identity,
      url: pin.location,
      revision: pin.state.revision,
      version: pin.state.version,
    };
  });
}

async function exportCheckout(checkout, into, pin) {
  if ((await git(checkout, ['rev-parse', 'HEAD'])).trim() !== pin.revision)
    throw new Error(`${pin.identity}: checkout differs from Package.resolved`);
  if (
    (
      await git(checkout, ['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=none'])
    ).trim()
  )
    throw new Error(`${pin.identity}: source checkout has local changes`);
  const submodules = (await git(checkout, ['submodule', 'status', '--recursive']))
    .split('\n')
    .filter(Boolean);
  if (submodules.some((line) => line[0] !== ' '))
    throw new Error(`${pin.identity}: uninitialised or changed submodule`);
  const files = (await git(checkout, ['ls-files', '--recurse-submodules', '-z'])).split('\0').filter(Boolean);
  for (const file of files) {
    if (isAbsolute(file) || file.split('/').includes('..')) throw new Error('unsafe source path');
    const from = join(checkout, file);
    const to = join(into, file);
    const info = await lstat(from);
    await mkdir(dirname(to), { recursive: true });
    if (info.isSymbolicLink()) {
      const target = await readlink(from);
      const resolved = relative(checkout, resolve(dirname(from), target));
      if (isAbsolute(target) || resolved.startsWith('..')) throw new Error('source symlink leaves checkout');
      await symlink(target, to);
    } else if (info.isFile()) await copyFile(from, to);
    else throw new Error(`${pin.identity}: unexported source entry ${file}`);
  }
  return { ...pin, files: files.length, submodules: submodules.map((line) => line.trim()) };
}

export async function packageMlxSources(out) {
  const native = await realpath(join(REPO, 'native/mlx-server'));
  const key = createHash('sha1').update(native).digest('hex').slice(0, 12);
  const derived =
    process.env.TAALCUT_MLX_SERVER_DERIVED || join(homedir(), 'Library/Caches/Taalcut-dev/mlx-server', key);
  const checkouts = join(derived, 'SourcePackages/checkouts');
  const names = await readdir(checkouts);
  const pins = packagePins(JSON.parse(await readFile(join(native, 'Package.resolved'), 'utf8')));
  await mkdir(out, { recursive: true });
  const scratch = await mkdtemp(join(out, '.mlx-source-'));
  try {
    const root = join(scratch, 'root');
    const inventory = [];
    for (const pin of pins) {
      const name = names.find((entry) => entry.toLowerCase() === pin.identity);
      if (!name) throw new Error(`${pin.identity}: missing build checkout`);
      inventory.push(await exportCheckout(join(checkouts, name), join(root, 'packages', pin.identity), pin));
    }
    await copyFile(join(native, 'Package.resolved'), join(root, 'Package.resolved'));
    await writeFile(join(root, 'SOURCE-INVENTORY.json'), `${JSON.stringify(inventory, null, 2)}\n`);
    await writeFile(
      join(root, 'README.txt'),
      'Exact dependency source used by Taalcut MLX Server 1.0.0.\n' +
        'SOURCE-INVENTORY.json records every Swift revision and recursive submodule revision.\n' +
        'All tracked source, build files and upstream licence texts are preserved. No .git history or credentials are included.\n' +
        'Use together with taalcut-mlx-server-1.0.0-source.tar.zst and its build.sh (Xcode 26, macOS 14 target).\n' +
        'To rebuild modified dependencies, use these package directories as local Swift package dependencies in Package.swift,\n' +
        'including their transitive packages. The original Package.resolved records the unmodified upstream revisions.\n',
    );
    const path = join(out, 'taalcut-mlx-server-1.0.0-dependencies-source.tar.zst');
    await packTarZst({ root, out: path, layout: 'stream', entries: await listEntries(root) });
    const keyPath = 'local-llm-runtime-mlx/1.0.0/source/taalcut-mlx-server-1.0.0-dependencies-source.tar.zst';
    const object = {
      key: keyPath,
      path,
      sha256: await sha256File(path),
      size: (await stat(path)).size,
      contentType: contentType(keyPath),
      cacheControl: IMMUTABLE,
    };
    const config = await loadR2Config();
    if (config.publicBase !== PUBLIC_BASE) throw new Error('unexpected component host');
    await uploadObject(r2Client(config), object, { log: console.log });
    const metadata = { url: publicUrl(PUBLIC_BASE, keyPath), size: object.size, sha256: object.sha256 };
    await writeFile(join(out, 'dependencies-source.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    return metadata;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: pack-mlx-dependency-source.mjs <output-directory>');
  console.log(JSON.stringify(await packageMlxSources(resolve(process.argv[2])), null, 2));
}
