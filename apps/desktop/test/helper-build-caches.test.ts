// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Other mac helper builds' compile caches, let go (FIX-OCRCOLD): only idle builds' folders, never one in use. */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processAlive, pruneHelperBuildCaches } from '../src/utility/roots/helper-build-caches';

const NOW = Date.UTC(2026, 10, 1, 12);
const HOUR = 60 * 60 * 1000;
const build = (digit: string) => `taalcut-mac-helper-${digit.repeat(16)}`;

let caches: string;
beforeEach(() => {
  caches = mkdtempSync(join(tmpdir(), 'taalcut-build-caches-'));
});
afterEach(() => {
  rmSync(caches, { recursive: true, force: true });
});

/** A folder dated `ago` before NOW, with `pids` marked in use. */
function folder(name: string, ago: number, pids: number[] = []): string {
  const path = join(caches, name);
  mkdirSync(join(path, 'com.apple.e5rt.e5bundlecache'), { recursive: true });
  if (pids.length > 0) {
    mkdirSync(join(path, '.in-use'));
    for (const pid of pids) writeFileSync(join(path, '.in-use', String(pid)), '');
  }
  const at = new Date(NOW - ago);
  utimesSync(path, at, at);
  return path;
}

describe('pruneHelperBuildCaches', () => {
  it("lets go of idle builds' folders only, and leaves everything else alone", async () => {
    folder(build('1'), 3 * 24 * HOUR); // this build: kept however old
    folder(build('2'), 3 * 24 * HOUR, [4242]); // in use by a live process: kept
    folder(build('3'), HOUR); // started an hour ago: kept
    folder(build('4'), 3 * 24 * HOUR, [9999]); // its process is gone: let go
    folder(build('5'), 2 * 24 * HOUR); // idle for two days: let go
    folder('taalcut-mac-helper', 30 * 24 * HOUR); // Developer ID builds' shared cache: main's sweep's
    folder('taalcut-mac-helper.baseline', 30 * 24 * HOUR);
    folder('Taalcut', 30 * 24 * HOUR);
    writeFileSync(join(caches, build('6')), ''); // a file with a build's name is no cache
    const target = folder('elsewhere', 30 * 24 * HOUR);
    symlinkSync(target, join(caches, build('7'))); // a link is never followed
    mkdirSync(join(caches, '.taalcut-discarded-taalcut-mac-helper-8888888888888888-1')); // an interrupted delete

    const pruned = pruneHelperBuildCaches({
      caches,
      keep: build('1'),
      now: () => NOW,
      alive: (pid) => pid === 4242,
    });
    expect(pruned.discarded).toEqual([build('4'), build('5')]);
    await pruned.deleted;
    expect(readdirSync(caches).sort()).toEqual(
      [
        'Taalcut',
        'elsewhere',
        'taalcut-mac-helper',
        'taalcut-mac-helper.baseline',
        build('1'),
        build('2'),
        build('3'),
        build('6'),
        build('7'),
      ].sort(),
    );
    expect(existsSync(join(target, 'com.apple.e5rt.e5bundlecache'))).toBe(true);
  });

  it('keeps every build folder when no build of its own is named (a Developer ID helper) except idle ones', async () => {
    folder(build('a'), 2 * 24 * HOUR);
    folder(build('b'), 10 * 60 * 1000);
    const pruned = pruneHelperBuildCaches({ caches, now: () => NOW, alive: () => false });
    expect(pruned.discarded).toEqual([build('a')]);
    await pruned.deleted;
    expect(readdirSync(caches)).toEqual([build('b')]);
  });

  it('does nothing without a caches folder, and tells a live process from a gone one', async () => {
    const pruned = pruneHelperBuildCaches({
      caches: join(caches, 'missing'),
      now: () => NOW,
      alive: () => false,
    });
    expect(pruned.discarded).toEqual([]);
    await pruned.deleted;
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(2 ** 22 + 12_345)).toBe(false);
  });
});
