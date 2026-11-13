// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Signatures of the release build, for whichever identity built it: ad-hoc
 * by default, or the Developer ID in TAALCUT_MAC_IDENTITY:
 *   TAALCUT_MAC_IDENTITY="Developer ID Application: …" pnpm --filter @taalcut/desktop e2e:packaged
 * Every Mach-O inside (helpers, frameworks, sqlite-vec, the FFmpeg sidecars
 * when packaged) must carry the same identity and hardened runtime, and with
 * a Developer ID a secure timestamp, as notarisation requires.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { isMachO, SIDECAR_BINARIES } from '../packaging/sidecars';
import { AD_HOC, macIdentity, teamIdOf } from '../packaging/signing';
import { openAsar } from './asar';
import { assertPackaged, PACKAGED_UNAVAILABLE, RELEASE_APP } from './packaged-app';

const IDENTITY = macIdentity(process.env);
const DEVELOPER_ID = IDENTITY !== AD_HOC;
const resources = join(RELEASE_APP, 'Contents', 'Resources');
const vec0 = join(resources, 'app.asar.unpacked', 'node_modules', 'sqlite-vec-darwin-arm64', 'vec0.dylib');

test.skip(Boolean(PACKAGED_UNAVAILABLE), PACKAGED_UNAVAILABLE);
test.beforeAll(() => assertPackaged(RELEASE_APP));

interface Signature {
  readonly report: string;
  readonly flags: string;
  readonly authorities: string[];
  readonly team: string | undefined;
  readonly timestamp: string | undefined;
}

/** codesign -dvv reports on stderr. */
function signatureOf(path: string): Signature {
  const report = spawnSync('codesign', ['-dvv', path], { encoding: 'utf8' }).stderr;
  return {
    report,
    flags: /flags=0x[0-9a-f]+\(([^)]*)\)/.exec(report)?.[1] ?? '',
    authorities: [...report.matchAll(/^Authority=(.*)$/gm)].map((match) => match[1] ?? ''),
    team: /^TeamIdentifier=(.*)$/m.exec(report)?.[1],
    timestamp: /^Timestamp=(.*)$/m.exec(report)?.[1],
  };
}

function entitlementKeys(path: string): string[] {
  const xml = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return [...xml.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1] ?? '').sort();
}

/** The signature every binary must have: this build's identity, hardened runtime, timestamp. */
function expectSignedByBuild(path: string): void {
  execFileSync('codesign', ['--verify', '--strict', path]);
  const signature = signatureOf(path);
  if (DEVELOPER_ID) {
    expect(signature.authorities, path).toEqual([
      IDENTITY,
      'Developer ID Certification Authority',
      'Apple Root CA',
    ]);
    expect(signature.team, path).toBe(teamIdOf(IDENTITY));
    expect(signature.flags, path).toBe('runtime');
    expect(signature.timestamp, path).toBeTruthy();
  } else {
    expect(signature.flags, path).toBe('adhoc,runtime');
  }
}

function machOFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return [];
    if (stat.isDirectory()) return machOFiles(path);
    return stat.isFile() && isMachO(path) ? [path] : [];
  });
}

test(`the app is signed ${DEVELOPER_ID ? 'with the Developer ID' : 'ad-hoc'}, hardened runtime, minimal entitlements`, () => {
  execFileSync('codesign', ['--verify', '--deep', '--strict', RELEASE_APP]);
  for (const name of readdirSync(join(resources, 'licences'))) {
    const file = join(resources, 'licences', name);
    expect(lstatSync(file).mode & 0o200, `ShipIt must remove quarantine from ${name}`).toBe(0o200);
  }
  expect(signatureOf(RELEASE_APP).report).toContain('Identifier=com.taalcut.app');
  expectSignedByBuild(RELEASE_APP);
  // Developer ID: JIT, voice consent recording and the selected Photos originals (LIB2-P; SECURITY.md).
  // Ad-hoc adds disable-library-validation (no team).
  expect(entitlementKeys(RELEASE_APP)).toEqual(
    DEVELOPER_ID
      ? [
          'com.apple.security.cs.allow-jit',
          'com.apple.security.device.audio-input',
          'com.apple.security.personal-information.photos-library',
        ]
      : [
          'com.apple.security.cs.allow-jit',
          'com.apple.security.cs.disable-library-validation',
          'com.apple.security.device.audio-input',
          'com.apple.security.personal-information.photos-library',
        ],
  );
});

test('every Mach-O inside is signed the same way (helpers, frameworks, sqlite-vec, sidecars)', () => {
  const binaries = machOFiles(join(RELEASE_APP, 'Contents'));
  expect(binaries.length).toBeGreaterThan(10);
  expect(binaries).toContain(vec0);
  for (const binary of binaries) expectSignedByBuild(binary);
});

test('sqlite-vec is unpacked from the ASAR and signed with the app', () => {
  const asar = openAsar(join(resources, 'app.asar'));
  expect(asar.files.get('node_modules/sqlite-vec-darwin-arm64/vec0.dylib')).toEqual({ unpacked: true });
  expect(asar.files.get('node_modules/sqlite-vec/index.mjs')).toEqual({ unpacked: false });
  expectSignedByBuild(vec0);
});

test('the FFmpeg sidecars, when packaged, are signed without entitlements and run from the app', () => {
  const bin = join(resources, 'bin');
  test.skip(
    !existsSync(bin),
    'no sidecars: tools/ffmpeg/dist (or TAALCUT_SIDECAR_DIR) was empty at build time',
  );
  for (const name of SIDECAR_BINARIES) {
    const binary = join(bin, name);
    expectSignedByBuild(binary);
    // Library validation stays on: no disable-library-validation, or anything else.
    expect(entitlementKeys(binary), name).toEqual([]);
    expect(execFileSync(binary, ['-version'], { encoding: 'utf8' })).toContain(`${name} version`);
  }
});

test('the real FFmpeg sidecars run on the GPU under the hardened runtime, with no entitlements', () => {
  const bin = join(resources, 'bin');
  const icd = join(bin, 'lib', 'MoltenVK_icd.json');
  test.skip(!existsSync(icd), 'the stand-in or missing sidecars have no MoltenVK; the real build does');
  expectSignedByBuild(join(bin, 'lib', 'libMoltenVK.dylib'));
  const scratch = mkdtempSync(join(tmpdir(), 'taalcut-ffmpeg-'));
  // As @taalcut/media will launch it: the Vulkan loader finds MoltenVK through the bundled ICD.
  const ffmpeg = (args: string[]) =>
    execFileSync(join(bin, 'ffmpeg'), ['-hide_banner', '-nostdin', '-v', 'error', ...args], {
      encoding: 'utf8',
      env: { ...process.env, VK_ICD_FILENAMES: icd, VK_DRIVER_FILES: icd },
    });
  const testsrc = ['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=1'];
  try {
    // (a) VideoToolbox hardware encode.
    const h264 = join(scratch, 'h264.mp4');
    ffmpeg([...testsrc, '-c:v', 'h264_videotoolbox', '-frames:v', '5', h264]);
    // (b) scale_vt on VideoToolbox frames, decoded from that file.
    ffmpeg([
      ...['-hwaccel', 'videotoolbox', '-hwaccel_output_format', 'videotoolbox_vld', '-i', h264],
      ...['-vf', 'scale_vt=w=80:h=60', '-frames:v', '1', '-f', 'null', '-'],
    ]);
    // (c) libplacebo tone-mapping on a Vulkan device through the bundled MoltenVK. dyld lets
    // ffmpeg load libMoltenVK only if both carry the same team; an ad-hoc build has none.
    if (DEVELOPER_ID) {
      ffmpeg([...testsrc, '-vf', 'libplacebo=tonemapping=bt.2446a', '-frames:v', '1', '-f', 'null', '-']);
    } else {
      test
        .info()
        .annotations.push({ type: 'skipped (ad-hoc)', description: 'libplacebo needs a Developer ID' });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('Gatekeeper: verify-signature.mjs passes; a Developer ID build waits only for notarisation', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'verify-signature.mjs');
  const result = spawnSync(process.execPath, [script, RELEASE_APP], { encoding: 'utf8' });
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  if (DEVELOPER_ID) {
    expect(result.stdout).toMatch(
      /spctl -a -t exec: (accepted \(Notarized Developer ID\)|rejected \(Unnotarized Developer ID\))/,
    );
  }
});
