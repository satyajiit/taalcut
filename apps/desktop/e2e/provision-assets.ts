// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Provisions what the indexing and gate e2e need on this machine, the way a user's machine gets it (on a
 * development Mac or Linux PC):
 *
 * - the components the indexing e2e installs (component-seed.ts INDEXING_COMPONENTS), downloaded from
 *   components.taalcut.app as the signed manifest (tools/components/manifest.signed.json) lists them for
 *   the hardware tiers: the manifest's signature checked as the app checks it, then each file's size and
 *   sha256, into the e2e's component cache (TAALCUT_COMPONENT_CACHE) with the manifest's install mode
 *   (provision-files.ts). A file already right stays; one with the right bytes and the wrong mode gets the mode.
 *   Each is this machine's artifact (its platform key, else `any`), as the app picks it;
 * - the make e2e's headless shell (headless-shell.ts), unless HyperFrames' download folder has it: the
 *   manifest's `hyperframes-headless-shell` component, the archive a user's machine installs, downloaded the
 *   same way into the cache and extracted into that folder;
 * - FFmpeg: built by tools/ffmpeg/build.sh into tools/ffmpeg/dist on a Mac, by tools/ffmpeg/build-linux.sh into
 *   dist/linux-x64 on Linux, unless that folder holds a build of the same inputs (`.inputs-sha256` there, written
 *   after a build);
 * - on a Mac, the mac helper, built by native/mac-helper/build.sh with a Swift 6.3.3 toolchain (an Xcode under
 *   /Applications that has it, when the selected one doesn't).
 *
 * A component the signed manifest has no artifact of for this machine fails the run and names it (the linux-x64
 * builds are in it since sequence 18, 2026-10-28).
 *
 *   pnpm --filter @taalcut/desktop e2e:provision                   everything above
 *   pnpm --filter @taalcut/desktop e2e:provision -- --keys         the cache keys, as KEY=value lines
 *   pnpm --filter @taalcut/desktop e2e:provision -- --install-build-tools
 *                                                                  also `brew install` FFmpeg's build tools
 */
import { spawn, spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createZstdDecompress } from 'node:zlib';
import {
  TRUSTED_MANIFEST_KEYS,
  verifySignedManifest,
  currentPlatform,
  type ComponentManifest,
  type VerifiedManifest,
} from '@taalcut/jobs';
import { COMPONENT_CACHE, INDEXING_COMPONENTS } from './component-seed';
import { DOWNLOADED_SHELL, HEADLESS_SHELL, shellAvailable } from './headless-shell';
import { download, holds, installMode, octal, type Artifact } from './provision-files';

const REPO = join(import.meta.dirname, '..', '..', '..');
const MANIFEST = join(REPO, 'tools', 'components', 'manifest.signed.json');
const FFMPEG = join(REPO, 'tools', 'ffmpeg');
const MAC = process.platform === 'darwin';
/** What tools/ffmpeg/build.sh (Linux: build-linux.sh) reads; a change to any of them is a new build. */
const FFMPEG_INPUTS = MAC
  ? ['build.sh', 'build-macos-deps.sh', 'versions.env', 'normalize-macho.py', 'check-paths.sh']
  : ['build-linux.sh', 'linux-in-container.sh', 'linux-x64.Dockerfile', 'versions.env', 'buildinfo.py'];
const FFMPEG_DIST = join(FFMPEG, 'dist', MAC ? '' : 'linux-x64');
const FFMPEG_BINARIES = MAC ? ['ffmpeg', 'ffprobe'] : ['bin/ffmpeg', 'bin/ffprobe'];
const FFMPEG_STAMP = join(FFMPEG_DIST, '.inputs-sha256');
const MAC_HELPER = join(REPO, 'native', 'mac-helper');
const SWIFT = 'Swift version 6.3.3';
/** The shell's component, and its archive's name in the cache. */
const SHELL = { id: 'hyperframes-headless-shell', file: 'hyperframes-headless-shell.tar.zst' } as const;
/** tools/ffmpeg/README.md's build tools: the binary build.sh calls, and the Homebrew formula that has it. */
const BUILD_TOOLS: Readonly<Record<string, string>> = {
  meson: 'meson',
  ninja: 'ninja',
  nasm: 'nasm',
  cmake: 'cmake',
  pkgconf: 'pkgconf',
  autoconf: 'autoconf',
  automake: 'automake',
  glibtoolize: 'libtool',
  python3: 'python',
};

interface Wanted {
  readonly id: string;
  /** The e2e's name for the file in the cache. */
  readonly file: string;
  readonly artifact: Artifact;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const say = (line: string) => process.stdout.write(`${line}\n`);

function fail(message: string): never {
  console.error(`e2e:provision: ${message}`);
  process.exit(1);
}

function run(command: string, args: readonly string[], options: SpawnSyncOptions = {}): void {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed (${result.status ?? result.signal})`);
}

/** The manifest the app ships, its signature checked against the keys the app trusts. */
function signedManifest(): VerifiedManifest {
  const verified = verifySignedManifest(JSON.parse(readFileSync(MANIFEST, 'utf8')), {
    trustedKeys: TRUSTED_MANIFEST_KEYS,
    release: false,
    now: Date.now(),
  });
  if (!verified.ok) fail(`${MANIFEST}: ${verified.error.code} ${verified.error.detail ?? ''}`);
  return verified.value;
}

/** A component the e2e needs: in the manifest, for a tier, with a file for this machine. */
function wanted(manifest: ComponentManifest, id: string, file: string, version?: string): Wanted {
  const component = manifest.components.find((entry) => entry.id === id);
  if (!component) fail(`${id} is not in ${MANIFEST}`);
  if (component.tiers.length === 0) fail(`${id} is on demand only: no tier installs it`);
  if (version !== undefined && component.version !== version)
    fail(`${id} is ${component.version} in ${MANIFEST}; the e2e reads ${version} (e2e/headless-shell.ts)`);
  const platform = currentPlatform();
  const artifact =
    component.artifacts.find((entry) => entry.platform === platform) ??
    component.artifacts.find((entry) => entry.platform === 'any');
  if (!artifact) fail(`${id} has no ${platform} or any artifact in ${MANIFEST}`);
  return { id, file, artifact };
}

/** Each component the indexing e2e installs. */
const wantedComponents = (manifest: ComponentManifest): Wanted[] =>
  INDEXING_COMPONENTS.map((local) => wanted(manifest, local.id, local.file));

const wantedShell = (manifest: ComponentManifest): Wanted =>
  wanted(manifest, SHELL.id, SHELL.file, HEADLESS_SHELL.version);

function ffmpegInputsHash(): string {
  return sha256(
    FFMPEG_INPUTS.map((file) => `${file}\0${sha256(readFileSync(join(FFMPEG, file)))}`).join('\n'),
  );
}

function keys(): Record<string, string> {
  const signed = signedManifest();
  const listed = [...wantedComponents(signed.manifest), wantedShell(signed.manifest)]
    .map(({ id, file, artifact }) => `${id}:${file}:${artifact.sha256}`)
    .sort()
    .join('\n');
  return {
    components: `e2e-components-s${signed.sequence}-${sha256(listed).slice(0, 16)}`,
    ffmpeg: `e2e-ffmpeg-${ffmpegInputsHash().slice(0, 16)}`,
  };
}

/** The artifact in the cache with its bytes and install mode: kept, its mode set, or downloaded. */
async function fetchInto(cache: string, want: Wanted): Promise<string> {
  const path = join(cache, want.file);
  const held = await holds(path, want.artifact);
  const mode = octal(installMode(want.artifact));
  if (held.state === 'right') say(`${want.id}: ${want.file} already right`);
  else if (held.state === 'repaired')
    say(`${want.id}: ${want.file} had the right bytes; mode ${octal(held.from)} → ${mode}`);
  else {
    try {
      const got = await download(want.artifact, path, fetch, (line) => console.warn(`${want.id}: ${line}`));
      say(`${want.id}: downloaded ${basename(got.url)} (${got.size} bytes) as ${want.file}, mode ${mode}`);
    } catch (error) {
      fail(`${want.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return path;
}

async function provisionComponents(cache: string, manifest: ComponentManifest): Promise<void> {
  const wantedFiles = wantedComponents(manifest);
  for (const want of wantedFiles) await fetchInto(cache, want);
  const names = new Set([...wantedFiles.map((want) => want.file), SHELL.file]);
  const other = readdirSync(cache).filter((name) => !names.has(name));
  if (other.length > 0) say(`left alone in ${cache}: ${other.join(', ')}`);
}

/** Extracts a tar.zst into `dir` with the system's tar (bsdtar on a Mac, GNU tar on Linux); what went wrong, if anything. */
async function extract(archive: string, dir: string): Promise<string | undefined> {
  const tar = spawn('/usr/bin/tar', ['-x', '-f', '-', '-C', dir], { stdio: ['pipe', 'inherit', 'inherit'] });
  const exited = new Promise<number | null>((resolve) => tar.on('close', resolve));
  try {
    await pipeline(createReadStream(archive), createZstdDecompress(), tar.stdin);
  } catch (error) {
    tar.kill();
    await exited;
    return `could not extract ${archive}: ${error instanceof Error ? error.message : String(error)}`;
  }
  const code = await exited;
  return code === 0 ? undefined : `tar could not extract ${archive} (exit ${code})`;
}

/** The shell's archive, checked against the manifest, extracted into HyperFrames' folder if that has none. */
async function provisionShell(cache: string, manifest: ComponentManifest): Promise<void> {
  if (shellAvailable()) {
    say(`${SHELL.id}: ${DOWNLOADED_SHELL} has it`);
    return;
  }
  const archive = await fetchInto(cache, wantedShell(manifest));
  mkdirSync(dirname(DOWNLOADED_SHELL), { recursive: true });
  const staging = mkdtempSync(`${DOWNLOADED_SHELL}.partial-`);
  const problem =
    (await extract(archive, staging)) ??
    (existsSync(join(staging, HEADLESS_SHELL.binary))
      ? undefined
      : `${archive} has no ${HEADLESS_SHELL.binary}`);
  if (problem !== undefined) {
    rmSync(staging, { recursive: true, force: true });
    fail(problem);
  }
  rmSync(DOWNLOADED_SHELL, { recursive: true, force: true });
  renameSync(staging, DOWNLOADED_SHELL);
  say(`${SHELL.id}: extracted into ${DOWNLOADED_SHELL}`);
}

function missingBuildTools(): string[] {
  return Object.keys(BUILD_TOOLS).filter((tool) => !existsSync(join('/opt/homebrew/bin', tool)));
}

function provisionFfmpeg(installTools: boolean): void {
  const inputs = ffmpegInputsHash();
  const built = FFMPEG_BINARIES.every((binary) => existsSync(join(FFMPEG_DIST, binary)));
  if (built && existsSync(FFMPEG_STAMP) && readFileSync(FFMPEG_STAMP, 'utf8').trim() === inputs) {
    say(`ffmpeg: ${FFMPEG_DIST} is a build of these inputs (${inputs.slice(0, 16)})`);
    return;
  }
  if (!MAC) {
    // In a container: Docker is the only build tool the host needs.
    run(join(FFMPEG, 'build-linux.sh'), [], { cwd: FFMPEG });
    writeFileSync(FFMPEG_STAMP, `${inputs}\n`);
    say(`ffmpeg: built (${inputs.slice(0, 16)})`);
    return;
  }
  let missing = missingBuildTools();
  if (missing.length > 0 && installTools) {
    run('brew', ['install', ...new Set(missing.map((tool) => BUILD_TOOLS[tool] ?? tool))]);
    missing = missingBuildTools();
  }
  if (missing.length > 0)
    fail(`FFmpeg's build tools are missing from /opt/homebrew/bin: ${missing.join(', ')}`);
  run('nice', ['-n', '10', join(FFMPEG, 'build.sh')], { cwd: FFMPEG });
  writeFileSync(FFMPEG_STAMP, `${inputs}\n`);
  say(`ffmpeg: built (${inputs.slice(0, 16)})`);
}

function swiftVersion(developerDir?: string): string {
  const env = developerDir ? { ...process.env, DEVELOPER_DIR: developerDir } : process.env;
  const result = spawnSync('swift', ['--version'], { env, encoding: 'utf8' });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

/** The selected toolchain when it is Swift 6.3.3, else an Xcode under /Applications that has it. */
function swiftDeveloperDir(): string | undefined {
  if (swiftVersion().includes(SWIFT)) return undefined;
  const found: string[] = [];
  for (const app of readdirSync('/Applications').filter((name) => /^Xcode.*\.app$/.test(name))) {
    const dir = join('/Applications', app, 'Contents', 'Developer');
    const version = swiftVersion(dir);
    if (version.includes(SWIFT)) return dir;
    found.push(`${app}: ${/Swift version [^ ]+/.exec(version)?.[0] ?? 'no swift'}`);
  }
  return fail(
    `no ${SWIFT} toolchain for the mac helper (${found.join('; ') || 'no Xcode in /Applications'})`,
  );
}

function provisionMacHelper(): void {
  const developerDir = swiftDeveloperDir();
  const env = developerDir ? { ...process.env, DEVELOPER_DIR: developerDir } : process.env;
  run('nice', ['-n', '10', join(MAC_HELPER, 'build.sh')], { cwd: MAC_HELPER, env });
}

// pnpm passes the `--` before a script's own arguments through.
const args = process.argv.slice(2).filter((arg) => arg !== '--');
if (args.includes('--keys')) {
  for (const [name, value] of Object.entries(keys())) say(`${name}=${value}`);
} else {
  const unknown = args.filter((arg) => arg !== '--install-build-tools');
  if (unknown.length > 0) fail(`unknown arguments: ${unknown.join(' ')}`);
  say(`components → ${COMPONENT_CACHE}`);
  mkdirSync(COMPONENT_CACHE, { recursive: true });
  const { manifest } = signedManifest();
  await provisionComponents(COMPONENT_CACHE, manifest);
  await provisionShell(COMPONENT_CACHE, manifest);
  provisionFfmpeg(args.includes('--install-build-tools'));
  if (MAC) provisionMacHelper();
  say('e2e:provision: done');
}
