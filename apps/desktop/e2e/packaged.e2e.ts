// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Static checks on the release build (release/mac-arm64), the one that ships:
 * fuses and what the ASAR contains. Signatures are checked in
 * packaged-signing.e2e.ts, refused switches in packaged-flags.e2e.ts.
 * Run with `pnpm --filter @taalcut/desktop e2e:packaged`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { expect, test } from '@playwright/test';
import { EXPECTED_FUSE_WIRE } from '../packaging/fuses';
import { openAsar } from './asar';
import { assertPackaged, binaryOf, PACKAGED_UNAVAILABLE, RELEASE_APP } from './packaged-app';

const resources = join(RELEASE_APP, 'Contents', 'Resources');

test.skip(Boolean(PACKAGED_UNAVAILABLE), PACKAGED_UNAVAILABLE);
test.beforeAll(() => assertPackaged(RELEASE_APP));

test('every fuse reads back as configured', async () => {
  const wire = await getCurrentFuseWire(binaryOf(RELEASE_APP));
  const read: Record<string, boolean> = {};
  const expected: Record<string, boolean> = {};
  for (const [index, enabled] of Object.entries(EXPECTED_FUSE_WIRE)) {
    const name = FuseV1Options[Number(index)] ?? index;
    read[name] = wire[Number(index) as FuseV1Options] === FuseState.ENABLE;
    expected[name] = enabled;
  }
  expect(read).toEqual(expected);
  // A fuse added by an Electron upgrade must get a decision in packaging/fuses.ts.
  const unknown = Object.keys(wire).filter((key) => key !== 'version' && !(key in EXPECTED_FUSE_WIRE));
  expect(unknown).toEqual([]);
});

test('ships the bundles and the production dependencies, with its integrity hash in Info.plist', () => {
  expect(existsSync(join(resources, 'app'))).toBe(false);
  const asar = openAsar(join(resources, 'app.asar'));
  const files = [...asar.files.keys()];
  // Outside node_modules: the bundles and package.json only.
  const shipped = files.filter((file) => !/^(out\/(renderer|utility|main)|node_modules)\//.test(file)).sort();
  expect(shipped).toEqual(['out/build-info.json', 'out/preload/index.cjs', 'package.json']);
  // sqlite-vec, its native library unpacked from the ASAR.
  expect(files).toEqual(
    expect.arrayContaining([
      'node_modules/sqlite-vec/package.json',
      'node_modules/sqlite-vec-darwin-arm64/vec0.dylib',
    ]),
  );
  expect(asar.files.get('node_modules/sqlite-vec-darwin-arm64/vec0.dylib')?.unpacked).toBe(true);
  // No native ONNX Runtime: the binding is the signed onnxruntime component (packaged-ml.e2e.ts).
  expect(files.filter((file) => file.startsWith('node_modules/onnxruntime-node/bin/'))).toEqual([]);
  // Crash reports' SDK is inlined into main: no copy of it in node_modules (packaging/app-files.ts).
  expect(files.filter((file) => /^node_modules\/@(sentry|opentelemetry)\//.test(file))).toEqual([]);
  // main's entry, plus pi-ai's lazily loaded providers (sign-in and key checks).
  const main = files.filter((file) => file.startsWith('out/main/'));
  expect(main).toContain('out/main/index.mjs');
  expect(main.filter((file) => !file.endsWith('.mjs'))).toEqual([]);
  // One entry per utility process, plus the chunks they share (pi-ai providers load lazily).
  const utility = files.filter((file) => file.startsWith('out/utility/'));
  expect(utility).toEqual(
    expect.arrayContaining(['agent', 'jobs', 'lan', 'render'].map((name) => `out/utility/${name}.mjs`)),
  );
  expect(utility.filter((file) => !file.endsWith('.mjs'))).toEqual([]);
  // The signed component manifest the jobs process loads (signed with the pinned release key).
  expect(existsSync(join(resources, 'manifest.signed.json'))).toBe(true);
  const integrity = execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :ElectronAsarIntegrity', join(RELEASE_APP, 'Contents', 'Info.plist')],
    { encoding: 'utf8' },
  );
  expect(integrity).toContain('Resources/app.asar');
  expect(integrity).toMatch(/hash = [0-9a-f]{64}/);
});

test('ships the resources the utility processes read: sandbox profiles, the phone page, the local network note', () => {
  for (const profile of ['offline.sb', 'fetcher.sb'])
    expect(existsSync(join(resources, 'sandbox', 'profiles', profile)), profile).toBe(true);
  expect(existsSync(join(resources, 'phone', 'index.html'))).toBe(true);
  expect(existsSync(join(resources, 'phone', 'tus.min.js'))).toBe(true);
  const note = execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :NSLocalNetworkUsageDescription', join(RELEASE_APP, 'Contents', 'Info.plist')],
    { encoding: 'utf8' },
  );
  expect(note).toMatch(/Wi-Fi/);
});

test('the release bundle contains no test hooks and no updater', () => {
  const asar = openAsar(join(resources, 'app.asar'));
  // The flavour and the mac helper's pin (packaging/mac-helper.ts), and no test setting.
  expect(JSON.parse(asar.readText('out/build-info.json'))).toEqual({
    flavour: 'release',
    macHelperPin: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  const main = [...asar.files.keys()]
    .filter((file) => file.startsWith('out/main/'))
    .map((file) => asar.readText(file))
    .join('\n');
  for (const marker of [
    'taalcut-self-test',
    'taalcut-update-feed',
    'TAALCUT_SELF_TEST',
    'TAALCUT_TEST_LOG_DIR',
    'electron-updater',
  ]) {
    expect(main, marker).not.toContain(marker);
  }
});

test('the release bundle keeps hardware acceleration on and watches the GPU (ADR 0002)', () => {
  const main = openAsar(join(resources, 'app.asar')).readText('out/main/index.mjs');
  expect(main).not.toMatch(/disableHardwareAcceleration\s*\(/);
  expect(main).not.toMatch(/appendSwitch\([^)]*(gpu|swiftshader|use-gl|use-angle)/i);
  expect(main).toContain('gpu-info-update');
});
