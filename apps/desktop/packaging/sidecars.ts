// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Sidecars: the LGPL FFmpeg build from tools/ffmpeg (P1-E2), shipped in
 * Taalcut.app/Contents/Resources/bin, where the desktop app points
 * @taalcut/media's binary resolver (`sidecarDir`):
 *
 *   bin/ffmpeg, bin/ffprobe          static arm64 binaries
 *   bin/lib/libMoltenVK.dylib        Vulkan on Metal, loaded by the binaries'
 *   bin/lib/MoltenVK_icd.json        Vulkan loader through this ICD (set
 *                                    VK_ICD_FILENAMES / VK_DRIVER_FILES to it)
 *   bin/BUILDINFO.json               pins, configure line, output hashes
 *   bin/LICENSES/                    FFmpeg and component licences (LGPL)
 *
 * Packaged only when dist/ has both binaries; TAALCUT_SIDECAR_DIR points
 * elsewhere (CI, or a test build).
 *
 * Signing is inside-out: afterPack (before electron-builder signs the app)
 * signs every Mach-O under bin/, libMoltenVK first, with the app's identity,
 * hardened runtime, a secure timestamp and no entitlements. Library
 * validation stays on: with a Developer ID, libMoltenVK carries the same team
 * as ffmpeg, so dyld lets the Vulkan loader open it. Ad-hoc signatures have
 * no team, so in ad-hoc builds the Vulkan path (libplacebo) is unavailable;
 * VideoToolbox doesn't load MoltenVK and keeps working (tools/ffmpeg/README.md,
 * "Hardened runtime"). signIgnore keeps @electron/osx-sign from re-signing
 * any of them with the app's entitlements (allow-jit). The app's signature
 * then seals them as resources.
 */
import {
  chmodSync,
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { AfterPackContext, FileSet } from 'electron-builder';
import { runChecked, runCommand, type Run } from './run';
import { AD_HOC, codesignArgs } from './signing';

export const SIDECAR_SOURCE = join('..', '..', 'tools', 'ffmpeg', 'dist');
export const SIDECAR_DESTINATION = 'bin';
export const SIDECAR_BINARIES = ['ffmpeg', 'ffprobe'] as const;
export const SIDECAR_FILES = [...SIDECAR_BINARIES, 'lib/**', 'BUILDINFO.json', 'LICENSE*', 'COPYING*'];
/** For mac.signIgnore (a regex tested against absolute paths). */
export const SIDECAR_SIGN_IGNORE = '/Contents/Resources/bin/';

export function sidecarSource(projectDir: string, env: NodeJS.ProcessEnv = {}): string {
  const override = env.TAALCUT_SIDECAR_DIR?.trim();
  return override ? resolve(override) : join(projectDir, SIDECAR_SOURCE);
}

/** extraResources entries: dist/ (binaries, MoltenVK, build info) and ../LICENSES, or nothing until both binaries exist. */
export function sidecarResources(projectDir: string, env: NodeJS.ProcessEnv = {}): FileSet[] {
  const source = sidecarSource(projectDir, env);
  const present = SIDECAR_BINARIES.filter((name) => existsSync(join(source, name)));
  if (present.length === 0) return [];
  if (present.length < SIDECAR_BINARIES.length) {
    throw new Error(`${source} has ${present.join(', ')} but needs both ffmpeg and ffprobe`);
  }
  const licences = join(source, '..', 'LICENSES');
  return [
    { from: source, to: SIDECAR_DESTINATION, filter: SIDECAR_FILES },
    ...(existsSync(licences) ? [{ from: licences, to: join(SIDECAR_DESTINATION, 'LICENSES') }] : []),
  ];
}

const MACH_O_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

export function isMachO(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const header = Buffer.alloc(4);
    return readSync(fd, header, 0, 4, 0) === 4 && MACH_O_MAGICS.has(header.readUInt32BE(0));
  } finally {
    closeSync(fd);
  }
}

/**
 * Replaces every symbolic link under `dir` with a copy of what it points to. electron-builder copies a
 * link as a link, so a source folder of links (a git worktree's tools/ffmpeg/dist pointing at the main
 * checkout) would make codesign sign the link's target in place, rewriting the source build. The
 * bundle must hold its own bytes before anything signs them. Returns the paths it replaced.
 */
export function dereferenceLinks(dir: string): string[] {
  const replaced: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (lstatSync(path).isSymbolicLink()) {
      const target = realpathSync(path);
      rmSync(path);
      if (statSync(target).isDirectory()) cpSync(target, path, { recursive: true, dereference: true });
      else {
        copyFileSync(target, path);
        chmodSync(path, statSync(target).mode & 0o777);
      }
      replaced.push(path);
    }
    if (lstatSync(path).isDirectory()) replaced.push(...dereferenceLinks(path));
  }
  return replaced;
}

/** Every Mach-O under `dir`, libraries in lib/ before the executables that load them. Links are never followed. */
function machOFiles(dir: string): string[] {
  const entries = readdirSync(dir).sort();
  const nested = entries.filter((name) => lstatSync(join(dir, name)).isDirectory());
  const files = entries.filter((name) => lstatSync(join(dir, name)).isFile());
  return [
    ...nested.flatMap((name) => machOFiles(join(dir, name))),
    ...files.map((name) => join(dir, name)).filter((file) => isMachO(file)),
  ];
}

/**
 * afterPack hook: signs every Mach-O under Contents/Resources/bin. `entitlements` maps a file's path under bin/ to
 * its own entitlements (the mac helper's photos-library key); every other sidecar is signed with none.
 */
export function createSidecarSigner(options: {
  identity: string;
  entitlements?: Readonly<Record<string, string>>;
  run?: Run;
  log?: (message: string) => void;
}): (context: AfterPackContext) => Promise<void> {
  const { identity, entitlements = {}, run = runCommand, log = (message) => console.warn(message) } = options;
  return async (context) => {
    if (context.electronPlatformName !== 'darwin') return;
    const app = `${context.packager.appInfo.productFilename}.app`;
    const binDir = join(context.appOutDir, app, 'Contents', 'Resources', SIDECAR_DESTINATION);
    if (!existsSync(binDir)) return;
    for (const path of dereferenceLinks(binDir))
      log(`copied in sidecar ${path.slice(binDir.length + 1)} (was a link)`);
    for (const file of machOFiles(binDir)) {
      const name = file.slice(binDir.length + 1);
      runChecked(
        run,
        'codesign',
        codesignArgs(identity, file, entitlements[name]),
        `signing sidecar ${name}`,
      );
      log(`signed sidecar ${name} (${identity === AD_HOC ? 'ad-hoc' : identity}, hardened runtime)`);
    }
  };
}
