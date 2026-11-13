// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runtime checks on the test build (release/test/mac-arm64): same fuses,
 * signature and packaging as the release build, but it accepts
 * --remote-debugging-port (so the renderer can be inspected over CDP) and the
 * test-only self-tests. _electron.launch can't drive a packaged app: it needs
 * --inspect, which the fuses turn off.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { signatureFreeSha256 } from '@taalcut/media';
import type { GpuReport } from '../src/main/gpu/gpu-report';
import { APP_CSP } from '../src/main/security/csp';
import { connectToPage, type CdpPage } from './cdp';
import {
  assertPackaged,
  devToolsPort,
  PACKAGED_UNAVAILABLE,
  type RunningApp,
  startPackaged,
  TEST_APP,
} from './packaged-app';
import { bridgeKeys, cspBlocks, fetchFromPage, nodeGlobals } from './renderer-probes';

test.skip(Boolean(PACKAGED_UNAVAILABLE), PACKAGED_UNAVAILABLE);
test.beforeAll(() => assertPackaged(TEST_APP));

/** Runs `--taalcut-self-test=<name>` and returns the JSON it prints (exit code 1 when that is an error). */
async function selfTest<T>(name: string, options: { app?: string; exitCode?: number } = {}): Promise<T> {
  const app = startPackaged(options.app ?? TEST_APP, { args: [`--taalcut-self-test=${name}`] });
  try {
    expect(await app.exitWithin(30_000), app.stderr()).toBe(options.exitCode ?? 0);
    const line = app
      .stdout()
      .split('\n')
      .find((l) => l.startsWith('TAALCUT_SELF_TEST '));
    return JSON.parse(line?.slice('TAALCUT_SELF_TEST '.length) ?? '{}') as T;
  } finally {
    await app.stop();
  }
}

test('sqlite-vec loads from app.asar.unpacked and answers a kNN query (signed, hardened runtime)', async () => {
  const result = await selfTest<Record<string, unknown>>('vector');
  expect(result.extension).toMatch(
    /Taalcut\.app\/Contents\/Resources\/app\.asar\.unpacked\/node_modules\/sqlite-vec-darwin-arm64\/vec0\.dylib$/,
  );
  expect(result.sqliteVec).toBe('v0.1.9');
  expect(result.nearest).toEqual(['east', 'east-north-east']);
});

test('USB N-API addon loads from app.asar.unpacked and enumerates under Electron 45', async () => {
  const result = await selfTest<{ electron: string; deviceCount: number; loaded: string[] }>('usb');
  expect(result.electron).toMatch(/^45\./);
  expect(Number.isInteger(result.deviceCount)).toBe(true);
  expect(result.deviceCount).toBeGreaterThanOrEqual(0);
  expect(result.loaded.length).toBeGreaterThan(0);
  for (const file of result.loaded)
    expect(file).toMatch(/Taalcut\.app\/Contents\/Resources\/app\.asar\.unpacked\/node_modules\/@node-usb\//);
});

test('the packaged mac helper is the build packaging pinned, and starts under the hardened runtime', async () => {
  const packed = realpathSync(join(TEST_APP, 'Contents', 'Resources', 'bin', 'taalcut-mac-helper'));
  const result = await selfTest<Record<string, unknown>>('mac-helper');
  expect(result).toEqual({
    path: packed,
    source: 'sidecar',
    pin: await signatureFreeSha256(packed),
    protocol: 2,
    version: '1.0.0',
  });
  // afterPack signed it with the app's identity and kept the helper's own entitlements.
  const entitlements = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', packed], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  expect(entitlements).toContain('com.apple.security.personal-information.photos-library');
});

test('a mac helper swapped into the app after packaging is refused, never started', async () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-swapped-helper-')));
  try {
    const app = join(scratch, 'Taalcut.app');
    // A clone (APFS copy-on-write) of the test build, with one byte of the helper's code changed.
    execFileSync('cp', ['-cR', TEST_APP, app]);
    const packed = join(app, 'Contents', 'Resources', 'bin', 'taalcut-mac-helper');
    const bytes = readFileSync(packed);
    bytes.writeUInt8(bytes.readUInt8(0x4000) ^ 1, 0x4000);
    rmSync(packed);
    writeFileSync(packed, bytes, { mode: 0o755 });
    const result = await selfTest<Record<string, unknown>>('mac-helper', { app, exitCode: 1 });
    expect(result).toEqual({
      error: 'media.sidecar_pin_mismatch',
      detail: `${packed}: ${await signatureFreeSha256(packed)}`,
      pin: await signatureFreeSha256(join(TEST_APP, 'Contents', 'Resources', 'bin', 'taalcut-mac-helper')),
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('the UI runs on the GPU: acceleration on, compositing and rasterisation enabled (ADR 0002)', async () => {
  const report = await selfTest<GpuReport>('gpu');
  test.info().annotations.push({
    type: 'gpu',
    description: `${report.devices.map((d) => d.vendor).join(', ')}; ${report.machineModel ?? '?'}`,
  });
  expect(report.hardwareAcceleration).toBe(true);
  if (report.cpuFallbacks.length > 0) {
    // Allowed only where there is no usable GPU (a CI virtual machine), and only with the reasons recorded.
    const fallbacks = JSON.stringify(report.cpuFallbacks);
    test.info().annotations.push({ type: 'cpu fallback', description: fallbacks });
    expect(process.env.CI, `CPU fallback on a machine that should have a GPU: ${fallbacks}`).toBeTruthy();
    for (const fallback of report.cpuFallbacks) expect(fallback.reason).not.toBe('');
    return;
  }
  expect(report.features.gpu_compositing).toMatch(/^enabled/);
  expect(report.features.rasterization).toMatch(/^enabled/);
  expect(report.devices.some((device) => device.active)).toBe(true);
});

test.describe('launched', () => {
  let app: RunningApp;
  let page: CdpPage;

  test.beforeAll(async () => {
    app = startPackaged(TEST_APP, { args: ['--remote-debugging-port=0'] });
    page = await connectToPage(await devToolsPort(app), 'app://');
  });

  test.afterAll(async () => {
    page?.close();
    await app?.stop();
  });

  test('opens app://taalcut/ with the preload bridge and no Node', async () => {
    expect(page.url).toBe('app://taalcut/');
    for (const [name, type] of Object.entries(await nodeGlobals(page))) expect(type, name).toBe('undefined');
    expect(await bridgeKeys(page)).toEqual(['connect']);
  });

  test('starts the eager utility processes from inside app.asar', async () => {
    // agent and jobs run their entries (out/utility/agent.mjs, jobs.mjs inside app.asar).
    const nodeServices = () =>
      execFileSync('ps', ['-ax', '-o', 'ppid=,command='], { encoding: 'utf8' })
        .split('\n')
        .filter(
          (line) => line.trim().startsWith(`${app.child.pid} `) && line.includes('node.mojom.NodeService'),
        ).length;
    await expect.poll(nodeServices, { timeout: 5_000 }).toBe(2);
  });

  test('serves the strict CSP and enforces it', async () => {
    expect(await fetchFromPage(page, '/')).toEqual({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      csp: APP_CSP,
    });
    expect(await cspBlocks(page)).toEqual({ inlineScriptRan: false, evalAllowed: false });
  });
});
