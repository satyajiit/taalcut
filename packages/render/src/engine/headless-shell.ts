// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pinned chrome-headless-shell (spike 03) and where it comes from, per platform. How
 * the app gets the shell is one choice, `HeadlessShellDelivery`, made in the
 * desktop render root: today the component manager installs it
 * (`hyperframes-headless-shell`, one artifact per platform); bundling it in Resources later is a change
 * of that one value. Development falls back to a copy already on disk.
 */
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type Result } from '@taalcut/core';
import { EngineUnavailable } from '../errors';

/** Chrome for Testing's platform names. `win64` is a typed slot: not pinned, never resolved this round. */
export const HEADLESS_SHELL_PLATFORMS = ['mac-arm64', 'linux64', 'win64'] as const;
export type HeadlessShellPlatform = (typeof HEADLESS_SHELL_PLATFORMS)[number];

/** One platform's build of the pinned version. */
export interface HeadlessShellBuild {
  readonly platform: HeadlessShellPlatform;
  readonly zipUrl: string;
  /** Pinned from the zip; null for a slot (no build checked yet). */
  readonly zipSha256: string | null;
  readonly zipSize: number | null;
  /** The binary inside the archive's top folder (the component keeps the zip's layout). */
  readonly binary: string;
  /** HyperFrames' (Puppeteer's) download cache folder for this platform, a development fallback. */
  readonly developmentCache: string;
  /**
   * The shell runs with Chrome's sandbox on. Linux: the user-namespace sandbox (Ubuntu 23.10+ needs the AppArmor
   * profile for the shell's path, apps/desktop/scripts/linux). macOS keeps HyperFrames' launch as spike 03 measured
   * it (`--no-sandbox`); Windows is a slot.
   */
  readonly sandbox: boolean;
}

/** Security-maintained stable Chrome for Testing; explicit chromePath and expectedChromiumMajor override HyperFrames. */
const VERSION = '157.0.8103.50';
const CFT = `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}`;

const build = (
  platform: HeadlessShellPlatform,
  pin: { readonly sha256: string; readonly size: number } | null,
  developmentCache: string,
  sandbox: boolean,
): HeadlessShellBuild => ({
  platform,
  zipUrl: `${CFT}/${platform}/chrome-headless-shell-${platform}.zip`,
  zipSha256: pin?.sha256 ?? null,
  zipSize: pin?.size ?? null,
  binary: join(
    `chrome-headless-shell-${platform}`,
    platform === 'win64' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell',
  ),
  developmentCache: `${developmentCache}-${VERSION}`,
  sandbox,
});

export const HEADLESS_SHELL_BUILDS: Readonly<Record<HeadlessShellPlatform, HeadlessShellBuild>> = {
  'mac-arm64': build(
    'mac-arm64',
    { sha256: '082e3fe8fcfac75aec2ef0949d70e8d2254a99ea465450e287e6c06a3f1863ed', size: 104_775_379 },
    'mac_arm',
    false,
  ),
  // The same pin as the linux-x64 component (tools/components/linux/pack-headless-shell.sh).
  linux64: build(
    'linux64',
    { sha256: '7bf0d41e424efd1d6281c4162993ab9dc5de92fac213c211614905a71c057d0f', size: 128_166_087 },
    'linux',
    true,
  ),
  win64: build('win64', null, 'win64', false),
};

/** The Chrome for Testing build a host runs; undefined where there is none (an Intel Mac, Linux on arm). */
export function headlessShellPlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): HeadlessShellPlatform | undefined {
  if (platform === 'darwin' && arch === 'arm64') return 'mac-arm64';
  if (platform === 'linux' && arch === 'x64') return 'linux64';
  if (platform === 'win32' && arch === 'x64') return 'win64';
  return undefined;
}

/**
 * The pinned shell for this host: the version, the component, and this platform's build. A host without a build
 * gets the mac-arm64 row's names, which no candidate path matches, so resolving fails with `engine_unavailable`.
 */
export const HEADLESS_SHELL = {
  version: VERSION,
  chromiumMajor: 157,
  componentId: 'hyperframes-headless-shell',
  ...HEADLESS_SHELL_BUILDS[headlessShellPlatform() ?? 'mac-arm64'],
  /** Whether this host has a build at all. */
  supported: headlessShellPlatform() !== undefined,
} as const;

/** 'component': the jobs process installs it; 'bundled': Contents/Resources/render (PO question, SPEC 15). */
export type HeadlessShellDelivery = 'component' | 'bundled';

/** How this build delivers the shell: the one place the choice is made (PO question, SPEC 15). */
export const HEADLESS_SHELL_DELIVERY: HeadlessShellDelivery = 'component';

export interface HeadlessShellSources {
  /** TAALCUT_HEADLESS_SHELL or a test's explicit path: wins when set. */
  readonly explicit?: string;
  /** The installed component's folder, when the registry has one. */
  readonly componentDir?: string;
  /** Resources/render, for the bundled delivery. */
  readonly bundledDir?: string;
  /** A checkout: also look in packages/render/.cache and HyperFrames' own download cache. */
  readonly development: boolean;
  /** packages/render, to find .cache (development only). */
  readonly packageDir?: string;
  /** Default: this host's build. */
  readonly build?: HeadlessShellBuild;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Candidate paths in order: explicit, delivery, then development copies. */
export function headlessShellCandidates(sources: HeadlessShellSources): string[] {
  const shell = sources.build ?? HEADLESS_SHELL;
  const candidates: string[] = [];
  if (sources.explicit) candidates.push(sources.explicit);
  if (sources.componentDir) candidates.push(join(sources.componentDir, shell.binary));
  if (sources.bundledDir) candidates.push(join(sources.bundledDir, shell.binary));
  if (sources.development) {
    if (sources.packageDir)
      candidates.push(join(sources.packageDir, '.cache', 'chrome-headless-shell', shell.binary));
    candidates.push(
      join(
        homedir(),
        '.cache',
        'hyperframes',
        'chrome',
        'chrome-headless-shell',
        shell.developmentCache,
        shell.binary,
      ),
    );
  }
  return candidates;
}

/** The first candidate that exists; render.engine_unavailable otherwise. */
export function resolveHeadlessShell(sources: HeadlessShellSources): Result<string> {
  for (const candidate of headlessShellCandidates(sources)) if (isFile(candidate)) return ok(candidate);
  const where = HEADLESS_SHELL.supported ? '' : ` (no build for ${process.platform}-${process.arch})`;
  return err(
    EngineUnavailable(
      { reason: 'missing' },
      {
        detail: `No chrome-headless-shell ${HEADLESS_SHELL.version}${where}; looked in ${headlessShellCandidates(sources).length} places`,
      },
    ),
  );
}

/** packages/render, found from this file (src/engine/headless-shell.ts, or a bundle next to it). */
export function renderPackageDir(): string | undefined {
  const here = import.meta.dirname;
  const candidate = join(here, '..', '..');
  return existsSync(join(candidate, 'package.json')) ? candidate : undefined;
}
