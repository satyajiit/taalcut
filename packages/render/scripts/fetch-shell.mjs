// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fetches the pinned chrome-headless-shell for development and tests
 * (packages/render SPEC section 4; the app gets it through the component
 * manager as `hyperframes-headless-shell`).
 *
 *   node scripts/fetch-shell.mjs                     download, verify, extract
 *   node scripts/fetch-shell.mjs --reuse-hyperframes-cache
 *                                                    copy HyperFrames' own download instead (unverified: no zip)
 *   node scripts/fetch-shell.mjs --pack              also write the component archive (reproducible tar.zst)
 *   node scripts/fetch-shell.mjs --pack --sign --entitlements <plist>
 *                                                    sign every Mach-O in the shell with the Developer ID in
 *                                                    TAALCUT_MAC_IDENTITY first (hardened runtime, secure timestamp;
 *                                                    the shell itself with the entitlements), as the hosted
 *                                                    component is (tools/components/hosting)
 *
 * The zip is untrusted until its size and sha256 match the pin, so it is
 * downloaded into a fresh empty folder and nothing reads it before that check.
 * It is extracted to .cache/chrome-headless-shell/, where
 * src/engine/headless-shell.ts looks in a checkout. Node built-ins plus
 * /usr/bin/unzip, and macOS's /usr/bin/tar (bsdtar) for --pack. On Linux the
 * component archive is made by tools/components/linux/pack-headless-shell.sh,
 * so --pack and --sign are macOS only.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { constants, createZstdCompress } from 'node:zlib';

// Keep in step with HEADLESS_SHELL_BUILDS in src/engine/headless-shell.ts (one pin per platform).
const PINS = {
  darwin: {
    version: '157.0.8103.50',
    url: 'https://storage.googleapis.com/chrome-for-testing-public/157.0.8103.50/mac-arm64/chrome-headless-shell-mac-arm64.zip',
    sha256: '082e3fe8fcfac75aec2ef0949d70e8d2254a99ea465450e287e6c06a3f1863ed',
    size: 104_775_379,
    top: 'chrome-headless-shell-mac-arm64',
    hyperframesCache: 'mac_arm',
  },
  linux: {
    version: '157.0.8103.50',
    url: 'https://storage.googleapis.com/chrome-for-testing-public/157.0.8103.50/linux64/chrome-headless-shell-linux64.zip',
    sha256: '7bf0d41e424efd1d6281c4162993ab9dc5de92fac213c211614905a71c057d0f',
    size: 128_166_087,
    top: 'chrome-headless-shell-linux64',
    hyperframesCache: 'linux',
  },
};
const PIN = PINS[process.platform];
if (!PIN) throw new Error(`No pinned chrome-headless-shell for ${process.platform}`);

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(PACKAGE_DIR, '.cache');
const TARGET = join(CACHE, 'chrome-headless-shell');
const ARCHIVE = join(CACHE, 'hyperframes-headless-shell.tar.zst');
const HYPERFRAMES_COPY = join(
  homedir(),
  '.cache',
  'hyperframes',
  'chrome',
  'chrome-headless-shell',
  `${PIN.hyperframesCache}-${PIN.version}`,
  PIN.top,
);

async function sha256Of(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function download(into) {
  const zip = join(into, `${PIN.top}.zip`);
  const response = await fetch(PIN.url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(zip));
  const { size } = await stat(zip);
  if (size !== PIN.size) throw new Error(`Size ${size} is not the pinned ${PIN.size}`);
  const digest = await sha256Of(zip);
  if (digest !== PIN.sha256) throw new Error(`sha256 ${digest} is not the pinned ${PIN.sha256}`);
  return zip;
}

/** Replaces TARGET with `source` (a folder holding PIN.top), atomically on the same volume. */
async function install(source) {
  const staging = await mkdtemp(join(CACHE, 'shell-staging-'));
  await cp(source, join(staging, PIN.top), { recursive: true, verbatimSymlinks: true });
  await rm(TARGET, { recursive: true, force: true });
  await rename(staging, TARGET);
}

async function walk(dir, files = []) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const path = join(dir, entry.name);
    files.push(path);
    if (entry.isDirectory()) await walk(path, files);
  }
  return files;
}

async function isMachO(path) {
  const handle = await open(path, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4), 0, 4, 0);
    return bytesRead === 4 && [0xfeedfacf, 0xcffaedfe, 0xcafebabe].includes(buffer.readUInt32BE(0));
  } finally {
    await handle.close();
  }
}

/**
 * Signs every Mach-O in the shell with `identity`: the libraries first, then the shell with `entitlements`
 * (only com.apple.security.cs.allow-jit: a hardened shell without JIT hangs at its GPU probe, spike 03).
 * Hardened runtime and a secure timestamp, each checked with codesign --verify --strict.
 */
async function sign(identity, entitlements) {
  const machO = [];
  for (const path of await walk(TARGET))
    if ((await lstat(path)).isFile() && (await isMachO(path))) machO.push(path);
  const shell = machO.filter((path) => path.endsWith(`/${PIN.top}/chrome-headless-shell`));
  if (shell.length !== 1) throw new Error('No chrome-headless-shell binary to sign');
  for (const path of [...machO.filter((path) => !shell.includes(path)), ...shell]) {
    const extra = shell.includes(path) ? ['--entitlements', entitlements] : [];
    const args = ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, ...extra, path];
    execFileSync('/usr/bin/codesign', args, { stdio: 'inherit' });
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', path], { stdio: 'inherit' });
  }
  return machO.length;
}

/**
 * The component archive, made the way tools/components' audio entry was: sorted names, ustar, uid and gid 0,
 * no macOS metadata, every mtime 0, executables 0755 and other files 0644, then zstd level 19.
 */
async function pack() {
  const root = TARGET;
  const entries = await walk(root);
  let extractedSize = 0;
  for (const path of entries) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Symlink in the shell: ${relative(root, path)}`);
    if (info.isDirectory()) await chmod(path, 0o755);
    else {
      await chmod(path, info.mode & 0o111 ? 0o755 : 0o644);
      extractedSize += info.size;
    }
    await utimes(path, 0, 0);
  }
  const list = entries.map((path) => relative(root, path));
  const listFile = join(CACHE, 'shell-files.txt');
  await writeFile(listFile, `${list.join('\n')}\n`);
  const tarPath = join(CACHE, 'hyperframes-headless-shell.tar');
  execFileSync(
    '/usr/bin/tar',
    [
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
      '-n',
      '-cf',
      tarPath,
      '-C',
      root,
      '-T',
      listFile,
    ],
    { env: { ...process.env, COPYFILE_DISABLE: '1', SOURCE_DATE_EPOCH: '0' }, stdio: 'inherit' },
  );
  await pipeline(
    createReadStream(tarPath),
    createZstdCompress({
      params: { [constants.ZSTD_c_compressionLevel]: 19, [constants.ZSTD_c_nbWorkers]: 0 },
    }),
    createWriteStream(ARCHIVE),
  );
  await rm(tarPath, { force: true });
  await rm(listFile, { force: true });
  const { size } = await stat(ARCHIVE);
  return { sha256: await sha256Of(ARCHIVE), size, extractedSize };
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      'reuse-hyperframes-cache': { type: 'boolean' },
      pack: { type: 'boolean' },
      sign: { type: 'boolean' },
      entitlements: { type: 'string' },
    },
  });
  const identity = process.env.TAALCUT_MAC_IDENTITY;
  if ((args.pack || args.sign) && process.platform !== 'darwin')
    throw new Error('--pack and --sign are macOS only; Linux: tools/components/linux/pack-headless-shell.sh');
  if (args.sign && (!args.pack || !identity || !args.entitlements))
    throw new Error('--sign needs --pack, --entitlements <plist> and TAALCUT_MAC_IDENTITY');
  await mkdir(CACHE, { recursive: true });
  if (args['reuse-hyperframes-cache']) {
    if (!existsSync(join(HYPERFRAMES_COPY, 'chrome-headless-shell')))
      throw new Error(`No HyperFrames copy at ${HYPERFRAMES_COPY}`);
    console.warn('Reusing HyperFrames’ cached shell: no zip to verify against the pinned sha256.');
    await install(HYPERFRAMES_COPY);
  } else {
    const downloads = await mkdtemp(join(CACHE, 'shell-download-'));
    try {
      const zip = await download(downloads);
      const extracted = join(downloads, 'extracted');
      await mkdir(extracted);
      execFileSync('/usr/bin/unzip', ['-q', zip, '-d', extracted], { stdio: 'inherit' });
      await install(join(extracted, PIN.top));
    } finally {
      await rm(downloads, { recursive: true, force: true });
    }
  }
  // stdout, not console.log: the repo's lint keeps console to warnings and errors outside scripts/.
  process.stdout.write(
    `chrome-headless-shell ${PIN.version}: ${join(TARGET, PIN.top, 'chrome-headless-shell')}\n`,
  );
  if (args.sign) process.stdout.write(`signed ${await sign(identity, args.entitlements)} Mach-O files\n`);
  if (args.pack) process.stdout.write(`${JSON.stringify({ archive: ARCHIVE, ...(await pack()) })}\n`);
}

await main();
