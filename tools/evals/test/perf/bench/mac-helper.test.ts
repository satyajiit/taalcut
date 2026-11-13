// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The mac helper preflight: found as the app finds it, run before anything, never skipped in silence. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  macHelperEnv,
  macHelperPath,
  preflightMacHelper,
  readOcrSetup,
  writeOcrSetup,
  type HelperProbe,
} from '../../../src/perf/bench/mac-helper';

const DIST = '/repo/native/mac-helper/dist/taalcut-mac-helper';

function probe(
  answer: string | Error,
  overrides: Partial<HelperProbe> = {},
): HelperProbe & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    platform: 'darwin',
    env: {},
    version(path) {
      asked.push(path);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    sha256: () => '7ae2d153a09cf3bb',
    ...overrides,
  };
}

describe('macHelperPath', () => {
  it('is $TAALCUT_MAC_HELPER when set, else the repo build', () => {
    expect(macHelperPath({}, '/repo')).toBe(DIST);
    expect(macHelperPath({ TAALCUT_MAC_HELPER: '  ' }, '/repo')).toBe(DIST);
    expect(macHelperPath({ TAALCUT_MAC_HELPER: '/opt/helper' }, '/repo')).toBe('/opt/helper');
    expect(() => macHelperPath({ TAALCUT_MAC_HELPER: 'dist/helper' }, '/repo')).toThrow(/absolute path/);
  });
});

describe('preflightMacHelper', () => {
  it('runs the helper and keeps its path and version', async () => {
    const helper = probe(
      '{"fluidAudio":{"version":"0.17.7"},"protocol":2,"swift":"6.3.3","version":"1.0.0"}\n',
    );
    await expect(preflightMacHelper(helper, '/repo', true)).resolves.toEqual({
      mode: 'helper',
      helper: { path: DIST, version: '1.0.0', sha256: '7ae2d153a09cf3bb' },
      reason: null,
    });
    expect(helper.asked).toEqual([DIST]);
  });

  it('fails, saying how to go on, when the helper is missing or does not answer', async () => {
    await expect(preflightMacHelper(probe(new Error('spawn ENOENT')), '/repo', true)).rejects.toThrow(
      /mac helper does not run \(.*taalcut-mac-helper --version: spawn ENOENT\).*build\.sh.*--no-mac-helper/s,
    );
    await expect(preflightMacHelper(probe('Usage: taalcut-mac-helper'), '/repo', true)).rejects.toThrow(
      /taalcut-mac-helper --version line 1: .*--no-mac-helper/s,
    );
    await expect(preflightMacHelper(probe('{"protocol":2}'), '/repo', true)).rejects.toThrow(/version/);
    await expect(preflightMacHelper(probe('\n'), '/repo', true)).rejects.toThrow(/printed nothing/);
  });

  it('is off, without asking, with --no-mac-helper or off macOS', async () => {
    const helper = probe(new Error('not asked'));
    await expect(preflightMacHelper(helper, '/repo', false)).resolves.toEqual({
      mode: 'off',
      helper: null,
      reason: 'run with --no-mac-helper',
    });
    const linux = probe(new Error('not asked'), { platform: 'linux' });
    await expect(preflightMacHelper(linux, '/repo', true)).resolves.toMatchObject({
      mode: 'off',
      reason: 'the mac helper is macOS only (this is linux)',
    });
    expect([...helper.asked, ...linux.asked]).toEqual([]);
  });
});

describe('macHelperEnv and the kept setup', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('points the app at the checked helper, or at a file that cannot exist', () => {
    const on = { mode: 'helper' as const, helper: { path: DIST, version: '1.0.0' }, reason: null };
    expect(macHelperEnv(on, '/bench/runs/a')).toEqual({ TAALCUT_MAC_HELPER: DIST });
    const off = { mode: 'off' as const, helper: null, reason: 'run with --no-mac-helper' };
    expect(macHelperEnv(off, '/bench/runs/a')).toEqual({
      TAALCUT_MAC_HELPER: '/bench/runs/a/no-mac-helper/taalcut-mac-helper',
    });
  });

  it('writes and reads ocr-setup.json; a bench from before the check has none', () => {
    dir = mkdtempSync(join(tmpdir(), 'taalcut-ocr-setup-'));
    const path = join(dir, 'ocr-setup.json');
    expect(readOcrSetup(path)).toBeNull();
    const setup = { mode: 'helper' as const, helper: { path: DIST, version: '1.0.0' }, reason: null };
    writeOcrSetup(path, setup);
    expect(readOcrSetup(path)).toEqual(setup);
  });
});
