// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-B6: main's sweep of the mac helper's Core ML compiles, on fake folders only (a fake home's cache, a fake
 * components root), never the real ~/Library/Caches/taalcut-mac-helper.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { coreMlComponentDirs } from '../src/main/compile-cache/coreml-components';
import { e5rtStore, helperCompileCache } from '../src/main/compile-cache/e5rt-store';
import { listsHelper, type SweepProbes } from '../src/main/compile-cache/mac-probes';
import { sweepCompileCache } from '../src/main/compile-cache/start';
import { darwin } from '../src/platform/darwin';
import { linux } from '../src/platform/linux';
import { win32 } from '../src/platform/win32';
import { sweepHelperCompiles, type SweepDeps } from '../src/main/compile-cache/sweep';
import { readSweepState, sweepStatePath, writeSweepState } from '../src/main/compile-cache/sweep-state';

let root: string;
let userData: string;
let components: string;
let cache: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'compile-cache-'));
  userData = join(root, 'userData');
  components = join(userData, 'components');
  cache = helperCompileCache(join(root, 'home'));
  mkdirSync(components, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const EMBED_V1 = 'installed/embeddinggemma-2-coreml/1.0.0-aaaaaaaaaaaa';
const EMBED_V2 = 'installed/embeddinggemma-2-coreml/1.1.0-bbbbbbbbbbbb';
const SHOTS = 'installed/transnetv2-coreml/1.0.0-cccccccccccc';
const PARAKEET = 'installed/parakeet-tdt-0-6b-v3-coreml/3.0.0-dddddddddddd';
const ONNX = 'installed/embeddinggemma-2/1.0.0-eeeeeeeeeeee';

/** Installs `dirs` (each with the files its kind has) and writes the registry naming them. */
function install(dirs: readonly string[]): void {
  const files: Record<string, string[]> = {
    [EMBED_V1]: ['EmbeddingGemma2Text.mlmodelc/model.mil'],
    [EMBED_V2]: ['EmbeddingGemma2Text.mlmodelc/model.mil'],
    [SHOTS]: ['TransNetV2.mlmodelc/coremldata.bin'],
    // FluidAudio's layout: the models one folder down.
    [PARAKEET]: ['parakeet-tdt-0.6b-v3/Encoder.mlmodelc/model.mil'],
    [ONNX]: ['onnx/model.onnx'],
  };
  const entries: Record<string, { id: string; dir: string }> = {};
  for (const dir of dirs) {
    for (const file of files[dir] ?? []) {
      mkdirSync(join(components, dir, file, '..'), { recursive: true });
      writeFileSync(join(components, dir, file), 'x');
    }
    const id = dir.split('/')[1] ?? dir;
    entries[id] = { id, dir };
  }
  writeFileSync(join(components, 'registry.json'), JSON.stringify({ schemaVersion: 1, components: entries }));
}

/** Compile entries in `build` folders of the fake cache. */
function compiled(...builds: string[]): void {
  for (const build of builds) {
    mkdirSync(join(cache, build, 'ABC'), { recursive: true });
    writeFileSync(join(cache, build, 'ABC', 'model.milhash'), 'x');
  }
}

function probes(build: string | null = '25G241', running = false): SweepProbes & { asked: number } {
  const probe = {
    asked: 0,
    osBuild: () => Promise.resolve(build),
    helperRunning: () => {
      probe.asked += 1;
      return Promise.resolve(running);
    },
  };
  return probe;
}

const deps = (overrides: Partial<SweepDeps> = {}): SweepDeps => ({
  store: e5rtStore(cache, () => 42),
  probes: probes(),
  componentsRoot: components,
  statePath: sweepStatePath(userData),
  now: () => new Date('2026-10-20T00:00:00Z'),
  ...overrides,
});

const builds = () => (existsSync(cache) ? readdirSync(cache).sort() : []);

describe('the Core ML components installed', () => {
  it('are the registry’s versions whose folder holds a compiled model or package, at the top or one down', () => {
    install([EMBED_V1, SHOTS, PARAKEET, ONNX]);
    expect(coreMlComponentDirs(components)).toEqual([EMBED_V1, PARAKEET, SHOTS]);
  });

  it('are unknown without a readable registry', () => {
    expect(coreMlComponentDirs(components)).toBeNull();
    writeFileSync(join(components, 'registry.json'), '{"components":');
    expect(coreMlComponentDirs(components)).toBeNull();
    writeFileSync(join(components, 'registry.json'), '{"components":{"x":{"id":"x"}}}');
    expect(coreMlComponentDirs(components)).toBeNull();
  });
});

describe('the sweep state', () => {
  it('round-trips, and reads a missing, torn or foreign file as never swept', async () => {
    const path = sweepStatePath(userData);
    expect(await readSweepState(path)).toBeNull();
    await writeSweepState(path, { v: 1, coreMlComponents: [SHOTS], sweptAt: 't' });
    expect(await readSweepState(path)).toEqual({ v: 1, coreMlComponents: [SHOTS], sweptAt: 't' });
    expect(readdirSync(userData)).toEqual(['compile-cache.json', 'components']);
    writeFileSync(path, '{"v":1,');
    expect(await readSweepState(path)).toBeNull();
    writeFileSync(path, '{"v":2}');
    expect(await readSweepState(path)).toBeNull();
  });

  it('fails on a file it can’t read, so the sweep keeps every compile', async () => {
    // A folder where the file should be: reading it fails with EISDIR, not "missing".
    mkdirSync(sweepStatePath(userData));
    await expect(readSweepState(sweepStatePath(userData))).rejects.toThrow(/EISDIR/);
  });
});

describe('sweepHelperCompiles', () => {
  it('only records on a userData’s first start, even with another build’s folder there', async () => {
    install([EMBED_V1, SHOTS]);
    compiled('25F84', '25G241');
    const outcome = await sweepHelperCompiles(deps());
    await outcome.deleted;
    expect(outcome.kind).toBe('unchanged');
    expect(builds()).toEqual(['25F84', '25G241']);
    expect((await readSweepState(sweepStatePath(userData)))?.coreMlComponents).toEqual([EMBED_V1, SHOTS]);
  });

  it('lets go of another macOS build’s folder and keeps this build’s while every version is still there', async () => {
    install([EMBED_V1, SHOTS]);
    await sweepHelperCompiles(deps());
    compiled('25F84', '25G241');
    const outcome = await sweepHelperCompiles(deps());
    await outcome.deleted;
    expect(outcome).toMatchObject({
      kind: 'swept',
      discarded: [{ build: '25F84', why: 'compiles for another macOS build (this one is 25G241)' }],
    });
    expect(builds()).toEqual(['25G241']);
    expect(readdirSync(join(cache, '..'))).toEqual(['com.apple.e5rt.e5bundlecache']);
  });

  it('lets go of this build’s folder once a recorded version is gone, then records the new ones', async () => {
    install([EMBED_V1, SHOTS]);
    await sweepHelperCompiles(deps());
    compiled('25G241');
    rmSync(join(components, EMBED_V1), { recursive: true });
    install([EMBED_V2, SHOTS]);
    const outcome = await sweepHelperCompiles(deps());
    await outcome.deleted;
    expect(outcome).toMatchObject({
      kind: 'swept',
      discarded: [{ build: '25G241', why: `component versions no longer installed: ${EMBED_V1}` }],
    });
    expect(builds()).toEqual([]);
    expect((await readSweepState(sweepStatePath(userData)))?.coreMlComponents).toEqual([EMBED_V2, SHOTS]);
    // A version added is no reason: nothing goes.
    compiled('25G241');
    install([EMBED_V2, SHOTS, PARAKEET]);
    expect((await sweepHelperCompiles(deps())).kind).toBe('unchanged');
    expect(builds()).toEqual(['25G241']);
  });

  it('removes and records nothing while any mac helper runs, or when the OS build can’t be read', async () => {
    install([EMBED_V1]);
    await sweepHelperCompiles(deps());
    compiled('25F84');
    const running = probes('25G241', true);
    expect(await sweepHelperCompiles(deps({ probes: running }))).toMatchObject({
      kind: 'deferred',
      reason: 'a mac helper is running and may be using the compiles',
    });
    expect(await sweepHelperCompiles(deps({ probes: probes(null) }))).toMatchObject({ kind: 'deferred' });
    expect(builds()).toEqual(['25F84']);
    // Nothing to let go: the processes are not even listed.
    const idle = probes('25F84', true);
    expect((await sweepHelperCompiles(deps({ probes: idle }))).kind).toBe('unchanged');
    expect(idle.asked).toBe(0);
  });

  it('decides nothing without a registry, and deletes what an interrupted delete left', async () => {
    mkdirSync(join(cache, '..', '.taalcut-discarded-25F84-1'), { recursive: true });
    compiled('25F84');
    const outcome = await sweepHelperCompiles(deps());
    await outcome.deleted;
    expect(outcome.kind).toBe('unchanged');
    expect(await readSweepState(sweepStatePath(userData))).toBeNull();
    expect(readdirSync(join(cache, '..'))).toEqual(['com.apple.e5rt.e5bundlecache']);
  });
});

describe('the compile store and links (IX3-F5, M6)', () => {
  it('lists only real build folders, and nothing when the cache itself is a link', async () => {
    compiled('25G241');
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(join(elsewhere, 'KEEP'), { recursive: true });
    symlinkSync(elsewhere, join(cache, '25F84'));
    symlinkSync(join(root, 'gone'), join(cache, '24A1'));
    const store = e5rtStore(cache, () => 42);
    expect(store.builds()).toEqual(['25G241']);
    await expect(store.discard('25F84')).rejects.toThrow(/is not a folder of the compile cache/);
    expect(existsSync(join(elsewhere, 'KEEP'))).toBe(true);
    const linkedRoot = join(root, 'linked-cache');
    symlinkSync(cache, linkedRoot);
    expect(e5rtStore(linkedRoot).builds()).toEqual([]);
    await expect(e5rtStore(linkedRoot).discard('25G241')).rejects.toThrow(/is not a folder/);
    expect(builds()).toContain('25G241');
  });
});

describe('main’s start of the sweep', () => {
  it('does nothing on a platform without a compile cache, and logs what it let go', async () => {
    const lines: string[] = [];
    const log = (line: string) => void lines.push(line);
    // Linux and Windows keep no compile cache.
    for (const platform of [linux, win32])
      await sweepCompileCache({ userData, cache: platform.compileCache(join(root, 'home')), log });
    expect(lines).toEqual([]);
    expect(darwin.compileCache(join(root, 'home'))?.store.root).toBe(
      join(root, 'home', 'Library', 'Caches', 'taalcut-mac-helper', 'com.apple.e5rt.e5bundlecache'),
    );
    install([SHOTS]);
    const options = {
      userData,
      log,
      cache: { store: e5rtStore(cache), probes: probes() },
    };
    await sweepCompileCache(options);
    compiled('25F84');
    await sweepCompileCache(options);
    expect(lines).toEqual([
      '[compile-cache] let go of 25F84 (compiles for another macOS build (this one is 25G241))',
    ]);
  });

  it('never fails the start: an error is logged and the compiles stay', async () => {
    const lines: string[] = [];
    install([SHOTS]);
    await sweepCompileCache({
      userData,
      log: () => undefined,
      cache: { store: e5rtStore(cache), probes: probes() },
    });
    compiled('25F84');
    const failing: SweepProbes = {
      osBuild: () => Promise.reject(new Error('sysctl: not found')),
      helperRunning: () => Promise.resolve(false),
    };
    await sweepCompileCache({
      userData,
      log: (line) => lines.push(line),
      cache: { store: e5rtStore(cache), probes: failing },
    });
    expect(lines).toEqual(['[compile-cache] sweep failed, compiles kept: Error: sysctl: not found']);
    expect(builds()).toEqual(['25F84']);
  });

  it('finds the helper in ps’s command names', () => {
    expect(
      listsHelper('/sbin/launchd\n/Applications/Taalcut.app/Contents/Resources/bin/taalcut-mac-helper\n'),
    ).toBe(true);
    expect(listsHelper('/usr/bin/taalcut-mac-helper-old\nnode\n')).toBe(false);
  });
});
