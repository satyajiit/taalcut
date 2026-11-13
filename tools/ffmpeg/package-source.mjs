#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Materialises FFmpeg's exact corresponding source, including the pinned upstream archives. Build scripts alone
 * and links to other people's servers are not the source archive. The archive includes each platform's recorded
 * BUILDINFO, all build recipes and licence texts, and .build/src in the layout those recipes consume offline.
 *
 *   node tools/ffmpeg/package-source.mjs --out <directory> [--upload]
 *
 * --upload uses the existing component bucket and refuses to replace any object. The returned metadata belongs
 * beside the distributed binaries; publishing it is a separate, explicit step after public URL verification.
 */
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { packTarZst } from '../components/hosting/archive.mjs';
import { loadR2Config } from '../components/hosting/credentials.mjs';
import { listEntries, sha256File } from '../components/hosting/files.mjs';
import { contentType, IMMUTABLE, publicUrl } from '../components/hosting/objects.mjs';
import { DEFAULT_CACHE, pinned } from '../components/hosting/pinned.mjs';
import { PUBLIC_BASE } from '../components/hosting/plan.mjs';
import { r2Client } from '../components/hosting/r2.mjs';
import { repoFiles } from '../components/hosting/sources.mjs';
import { uploadObject } from '../components/hosting/upload-object.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = 'tools/ffmpeg';
const BUILDINFO = ['dist/BUILDINFO.json', 'dist/linux-x64/BUILDINFO.json'];

/** versions.env contains literal pins, never evaluated as shell code here. */
export function readPins(text) {
  return Object.fromEntries(
    text.split('\n').flatMap((line) => {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      return match ? [[match[1], match[2].replace(/^"(.*)"$/, '$1')]] : [];
    }),
  );
}

/** The recipes' own fetch lines are the inventory, so a newly added input cannot silently be omitted. */
export function archiveInputs(scripts, pins) {
  const found = new Map();
  for (const script of scripts) {
    for (const line of script.split('\n')) {
      if (!line.startsWith('fetch ')) continue;
      const parts = [...line.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      if (parts.length !== 3) throw new Error(`unrecognised source fetch: ${line}`);
      const [file, url, hash] =
        parts[0].endsWith('_URL}') || parts[0].endsWith('_URL') ? [parts[1], parts[0], parts[2]] : parts;
      const expand = (value) =>
        value.replace(/\$\{?([A-Z0-9_]+)\}?/g, (_, key) => {
          if (key === 'SRC') return '';
          if (!(key in pins)) throw new Error(`missing pin ${key}`);
          return pins[key];
        });
      const name = expand(file).replace(/^\//, '');
      const pin = { file: name, url: expand(url), sha256: expand(hash) };
      if (!/^[\w.+-]+$/.test(name) || !/^https:\/\//.test(pin.url) || !/^[a-f0-9]{64}$/.test(pin.sha256))
        throw new Error(`invalid source pin ${name}`);
      const previous = found.get(name);
      if (previous && JSON.stringify(previous) !== JSON.stringify(pin))
        throw new Error(`conflicting source pin ${name}`);
      found.set(name, pin);
    }
  }
  if (found.size === 0) throw new Error('no source fetches found');
  return [...found.values()].sort((a, b) => a.file.localeCompare(b.file, 'en'));
}

/** Refuse an archive whose current pins no longer describe the binaries' recorded source. */
export function verifySources(inputs, builds) {
  for (const build of builds) {
    for (const source of [...build.sources, ...(build.toolchain?.tools ?? [])]) {
      if (!inputs.some((pin) => pin.url === source.url && pin.sha256 === source.sha256))
        throw new Error(`BUILDINFO source missing or changed: ${source.name}@${source.version}`);
    }
  }
}

export async function packageSource({ out, upload = false, repo = REPO, log = console.log }) {
  await mkdir(out, { recursive: true });
  const scratch = await mkdtemp(join(out, '.source-'));
  try {
    const root = join(scratch, 'root');
    const read = (file) => readFile(join(repo, ROOT, file), 'utf8');
    const builds = await Promise.all(BUILDINFO.map(async (file) => JSON.parse(await read(file))));
    const inputs = archiveInputs(
      await Promise.all(['build.sh', 'build-linux.sh'].map(read)),
      readPins(await read('versions.env')),
    );
    verifySources(inputs, builds);
    const files = await repoFiles(repo, {
      paths: [ROOT, 'LICENSE'],
      exclude:
        '^tools/ffmpeg/(?:source-distribution\\.json$|dist/(?!BUILDINFO\\.json$|linux-x64/BUILDINFO\\.json$))',
    });
    for (const file of files) {
      const target = join(root, file);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(repo, file), target);
    }
    const src = join(root, ROOT, '.build', 'src');
    await mkdir(src, { recursive: true });
    for (const input of inputs) {
      const cached = await pinned(input, { cacheDir: DEFAULT_CACHE, log });
      await copyFile(cached, join(src, input.file));
      log(`source ${input.file}: ${input.sha256}`);
    }
    await writeFile(
      join(root, 'SOURCE-INVENTORY.json'),
      `${JSON.stringify({ schemaVersion: 1, inputs }, null, 2)}\n`,
    );
    const temporary = join(out, 'source.tar.zst');
    const extractedSize = await packTarZst({
      root,
      out: temporary,
      layout: 'stream',
      entries: await listEntries(root),
    });
    const sha256 = await sha256File(temporary);
    const version = builds[0].ffmpeg_version;
    const name = `ffmpeg-${version}-source-${sha256.slice(0, 16)}.tar.zst`;
    const path = join(out, name);
    await rename(temporary, path);
    const key = `ffmpeg/${version}/source/${name}`;
    const object = {
      key,
      path,
      sha256,
      size: (await stat(path)).size,
      contentType: contentType(key),
      cacheControl: IMMUTABLE,
    };
    if (upload) {
      const config = await loadR2Config();
      if (config.publicBase !== PUBLIC_BASE)
        throw new Error('R2 public base does not match component hosting');
      log(await uploadObject(r2Client(config), object, { log }));
    }
    const metadata = {
      schemaVersion: 1,
      url: publicUrl(PUBLIC_BASE, key),
      sha256,
      size: object.size,
      extractedSize,
      license: 'LGPL-2.1-or-later AND AGPL-3.0-or-later AND LicenseRef-ThirdParty',
      platforms: builds.map((build, i) => ({
        platform: i === 0 ? 'darwin-arm64' : 'linux-x64',
        buildinfoSha256: undefined,
        outputs: build.outputs.map(({ name: output, sha256: digest }) => ({ name: output, sha256: digest })),
      })),
      instructions:
        'Extract the archive, read tools/ffmpeg/README.md and SOURCE.md, then run build.sh (macOS) or build-linux.sh (Linux). The included .build/src archives are checked by SHA-256 and reused without fetching upstream source.',
    };
    for (let i = 0; i < BUILDINFO.length; i++)
      metadata.platforms[i].buildinfoSha256 = await sha256File(join(repo, ROOT, BUILDINFO[i]));
    await writeFile(join(out, 'source-distribution.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    return metadata;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, upload: { type: 'boolean' } } });
  if (!values.out) throw new Error('usage: package-source.mjs --out <directory> [--upload]');
  try {
    console.log(
      JSON.stringify(await packageSource({ out: resolve(values.out), upload: values.upload }), null, 2),
    );
  } catch (error) {
    console.error(`source: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
