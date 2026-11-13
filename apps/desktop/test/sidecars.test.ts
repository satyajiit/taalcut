// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AfterPackContext } from 'electron-builder';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Run } from '../packaging/run';
import { MAC_HELPER_BINARY } from '../packaging/mac-helper';
import {
  createSidecarSigner,
  dereferenceLinks,
  isMachO,
  sidecarResources,
  sidecarSource,
  SIDECAR_BINARIES,
} from '../packaging/sidecars';

const DEVELOPER_ID = 'Developer ID Application: Matterward Labs Private Limited (WW382UC8JD)';
/** The first bytes of an arm64 Mach-O executable (MH_MAGIC_64, little-endian). */
const MACH_O = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]);
let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'taalcut-sidecars-'));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

function write(dir: string, name: string, bytes: Buffer | string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, bytes);
  chmodSync(file, 0o755);
  return file;
}

describe('sidecarResources', () => {
  it('adds nothing until tools/ffmpeg/dist has the binaries', () => {
    expect(sidecarResources(join(scratch, 'apps', 'desktop'))).toEqual([]);
  });

  it('copies the binaries, MoltenVK, the build info and the licences into Resources/bin', () => {
    const dist = join(scratch, 'tools', 'ffmpeg', 'dist');
    for (const name of SIDECAR_BINARIES) write(dist, name, MACH_O);
    const filter = ['ffmpeg', 'ffprobe', 'lib/**', 'BUILDINFO.json', 'LICENSE*', 'COPYING*'];
    expect(sidecarResources(join(scratch, 'apps', 'desktop'))).toEqual([{ from: dist, to: 'bin', filter }]);
    write(join(scratch, 'tools', 'ffmpeg', 'LICENSES'), 'FFmpeg-COPYING.LGPLv2.1', 'LGPL');
    expect(sidecarResources(join(scratch, 'apps', 'desktop'))).toEqual([
      { from: dist, to: 'bin', filter },
      { from: join(scratch, 'tools', 'ffmpeg', 'LICENSES'), to: join('bin', 'LICENSES') },
    ]);
  });

  it('can take them from TAALCUT_SIDECAR_DIR, and refuses only one of the two', () => {
    const elsewhere = join(scratch, 'elsewhere');
    expect(sidecarSource('/x', { TAALCUT_SIDECAR_DIR: elsewhere })).toBe(elsewhere);
    write(elsewhere, 'ffmpeg', MACH_O);
    expect(() => sidecarResources('/x', { TAALCUT_SIDECAR_DIR: elsewhere })).toThrow(
      /needs both ffmpeg and ffprobe/,
    );
  });
});

describe('createSidecarSigner', () => {
  function appWithBin(): string {
    const bin = join(scratch, 'out', 'Taalcut.app', 'Contents', 'Resources', 'bin');
    write(bin, 'ffprobe', MACH_O);
    write(bin, 'ffmpeg', MACH_O);
    write(bin, 'LICENSE.md', '# LGPL');
    write(join(bin, 'lib'), 'libMoltenVK.dylib', MACH_O);
    write(join(bin, 'lib'), 'MoltenVK_icd.json', '{}');
    return join(scratch, 'out');
  }

  const context = (appOutDir: string, platform = 'darwin') =>
    ({
      appOutDir,
      electronPlatformName: platform,
      packager: { appInfo: { productFilename: 'Taalcut' } },
    }) as unknown as AfterPackContext;

  function recordingRun(): { run: Run; calls: string[][] } {
    const calls: string[][] = [];
    const run: Run = (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: '', stderr: '' };
    };
    return { run, calls };
  }

  it('signs every Mach-O under bin/, MoltenVK first, with the identity, hardened runtime and a timestamp', async () => {
    const { run, calls } = recordingRun();
    const out = appWithBin();
    await createSidecarSigner({ identity: DEVELOPER_ID, run, log: () => {} })(context(out));
    const bin = join(out, 'Taalcut.app', 'Contents', 'Resources', 'bin');
    const signed = (file: string) => [
      'codesign',
      '--force',
      '--sign',
      DEVELOPER_ID,
      '--options',
      'runtime',
      '--timestamp',
      file,
    ];
    // Developer ID: no entitlements; library validation accepts MoltenVK (same team).
    expect(calls).toEqual([
      signed(join(bin, 'lib', 'libMoltenVK.dylib')),
      signed(join(bin, 'ffmpeg')),
      signed(join(bin, 'ffprobe')),
    ]);
    expect(isMachO(join(bin, 'LICENSE.md'))).toBe(false);
  });

  it("signs taalcut-mac-helper with the same hardened-runtime arguments and the helper's own entitlements", async () => {
    const { run, calls } = recordingRun();
    const bin = join(scratch, 'out', 'Taalcut.app', 'Contents', 'Resources', 'bin');
    const helper = write(bin, MAC_HELPER_BINARY, MACH_O);
    const ffmpeg = write(bin, 'ffmpeg', MACH_O);
    const entitlements = { [MAC_HELPER_BINARY]: '/repo/native/mac-helper/entitlements.plist' };
    await createSidecarSigner({ identity: DEVELOPER_ID, entitlements, run, log: () => {} })(
      context(join(scratch, 'out')),
    );
    const signing = ['codesign', '--force', '--sign', DEVELOPER_ID, '--options', 'runtime', '--timestamp'];
    expect(calls).toEqual([
      [...signing, ffmpeg],
      [...signing, '--entitlements', '/repo/native/mac-helper/entitlements.plist', helper],
    ]);
  });

  it('copies linked sidecars into the bundle before signing, so the source build is never signed in place', async () => {
    // A worktree's tools/ffmpeg/dist links to the main checkout; electron-builder copies the links as links.
    const source = join(scratch, 'source');
    const realFfmpeg = write(source, 'ffmpeg', MACH_O);
    write(join(source, 'lib'), 'libMoltenVK.dylib', MACH_O);
    const bin = join(scratch, 'out', 'Taalcut.app', 'Contents', 'Resources', 'bin');
    mkdirSync(bin, { recursive: true });
    symlinkSync(realFfmpeg, join(bin, 'ffmpeg'));
    symlinkSync(join(source, 'lib'), join(bin, 'lib'));
    const { run, calls } = recordingRun();
    await createSidecarSigner({ identity: DEVELOPER_ID, run, log: () => {} })(context(join(scratch, 'out')));
    expect(lstatSync(join(bin, 'ffmpeg')).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(bin, 'lib')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(bin, 'ffmpeg'))).toEqual(MACH_O);
    expect(statSync(join(bin, 'ffmpeg')).mode & 0o777).toBe(0o755);
    // Only the bundle's own copies are signed.
    expect(calls.map((call) => call.at(-1))).toEqual([
      join(bin, 'lib', 'libMoltenVK.dylib'),
      join(bin, 'ffmpeg'),
    ]);
    expect(dereferenceLinks(bin)).toEqual([]);
  });

  it('fails the build when codesign fails', async () => {
    const run: Run = () => ({ status: 1, stdout: '', stderr: 'errSecInternalComponent' });
    await expect(createSidecarSigner({ identity: DEVELOPER_ID, run })(context(appWithBin()))).rejects.toThrow(
      /signing sidecar lib\/libMoltenVK\.dylib failed .*errSecInternalComponent/,
    );
  });

  it('does nothing without a bin/ folder, or off macOS', async () => {
    const run: Run = () => {
      throw new Error('should not run');
    };
    await createSidecarSigner({ identity: DEVELOPER_ID, run })(context(scratch));
    await createSidecarSigner({ identity: DEVELOPER_ID, run })(context(appWithBin(), 'linux'));
  });
});
