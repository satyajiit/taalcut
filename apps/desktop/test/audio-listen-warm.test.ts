// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-G2 in the jobs process: after a fresh install, the SFX bank's titles are embedded for search only once the
 * bank and the CLAP builds this machine runs (the download's pick) are installed and current, through a low-priority
 * `audio.listen.query` job (`bankTitles`) on the process's own queue (EAR1-R1: the listen lane and the 'gpu' slot,
 * not the service directly); a background warm-up never installs or downloads anything. The jobs' own model
 * lookups ask for that same build by name. With the real models (`TAALCUT_EAR1_MODELS`) and a built bank, the jobs
 * root (composeListen over media's real derived cache) is timed: a machine's first search cold, the warm-up, and the
 * first search after a restart, which reads the titles back from `listen/` instead of embedding them.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createContainer,
  createDirectJobRunner,
  createEventBus,
  createManualClock,
  err,
  EventBusToken,
  JobRunnerToken,
  NotFoundError,
  ok,
  unwrap,
  type AsyncResult,
  type JobKind,
  type JobRunOptions,
} from '@taalcut/core';
import { audioListenAnalyseJob, audioListenQueryJob, type SearchSoundsResult } from '@taalcut/audio';
import {
  parseManifest,
  type ComponentManager,
  type ComponentState,
  type MachineDescription,
} from '@taalcut/jobs';
import { createDerivedCache, type MediaService } from '@taalcut/media';
import type { HardwareInfo } from '@taalcut/models';
import { afterAll, describe, expect, it } from 'vitest';
import { ComponentManagerToken, ComponentVariantToken, type ProbedHardware } from '../src/shared/tokens';
import { composeListen, ListenServiceToken } from '../src/utility/roots/audio-listen';
import { warmListenTitles, warmsListenTitles } from '../src/utility/roots/audio-listen-warm';
import { signedComponentManager } from '../src/utility/roots/components';
import { testConfig } from './helpers/roots';

const home = (path: string) => path.replace(/^~(?=\/)/, process.env.HOME ?? '~');
const MODELS = process.env.TAALCUT_EAR1_MODELS ? home(process.env.TAALCUT_EAR1_MODELS) : undefined;
const BANK = home(
  process.env.TAALCUT_SFX_BANK ?? join(import.meta.dirname, '../../../packages/audio/.cache/packs/sfx-bank'),
);
const root = mkdtempSync(join(tmpdir(), 'taalcut-listen-warm-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The download's pick on a Metal Mac: each CLAP group's fp16 member. */
const METAL_PICK = (id: string): AsyncResult<string> =>
  Promise.resolve(ok(id.startsWith('clap-general-') && !id.endsWith('-fp16') ? `${id}-fp16` : id));
const NOW = Date.parse('2026-11-07T12:00:00Z');
const JUST_NOW = { installedAt: new Date(NOW - 1000).toISOString() };

/** A component manager whose `states` are what list() says; it records every install asked of it. */
function components(states: Readonly<Record<string, ComponentState>>, pathOf = (id: string) => `/c/${id}`) {
  const installs: string[] = [];
  const ref = (id: string) => ({ id, version: '1', path: pathOf(id), notice: '' });
  const manager = {
    list: async () =>
      Object.entries(states).map(([id, state]) => ({ id, state, ...(state ? { installed: ref(id) } : {}) })),
    get: async (id: string) => (states[id] ? ref(id) : undefined),
    install: async (id: string) => {
      installs.push(id);
      return states[id] === 'installed' ? ok(ref(id)) : err(NotFoundError({ entity: 'component', id }));
    },
  } as unknown as ComponentManager;
  return { manager, installs };
}

function fakeContainer(states: Readonly<Record<string, ComponentState>>) {
  const queries: Array<{ op: string; params: unknown }> = [];
  const enqueued: Array<{ kind: string; priority?: string }> = [];
  const service = {
    query: async () => {
      throw new Error('the warm-up goes through the queue, not the service');
    },
  };
  // The jobs process's queue: records the job and answers as the listen job would.
  const queue = {
    run: async (kind: JobKind<unknown, unknown>, input: unknown, options: JobRunOptions = {}) => {
      const { op, params } = input as { op: string; params: unknown };
      enqueued.push({ kind: kind.kind, ...(options.priority ? { priority: options.priority } : {}) });
      queries.push({ op, params });
      return ok({ op, result: { titles: 246 } });
    },
  };
  const { manager, installs } = components(states);
  const container = createContainer()
    .value(ComponentManagerToken, manager)
    .value(ComponentVariantToken, METAL_PICK)
    .value(JobRunnerToken, queue as never)
    .value(ListenServiceToken, service as never);
  const lines: string[] = [];
  const warm = (id: string, when = JUST_NOW) =>
    warmListenTitles(
      container,
      { id, ...when },
      (line) => lines.push(line),
      () => NOW,
    );
  return { container, queries, enqueued, installs, lines, warm };
}

const ALL: Record<string, ComponentState> = {
  'sfx-bank': 'installed',
  'clap-general-audio-fp16': 'installed',
  'clap-general-text-fp16': 'installed',
};

describe('the bank titles warm-up after an install', () => {
  it('waits for the bank and either build of both CLAP models', () => {
    for (const id of ['sfx-bank', 'clap-general-text', 'clap-general-text-fp16', 'clap-general-audio-fp16'])
      expect(warmsListenTitles(id)).toBe(true);
    for (const id of ['ast-audioset-fp16', 'sfx-pack', 'whisper-small', 'clap-general-text-int8'])
      expect(warmsListenTitles(id)).toBe(false);
  });

  it('queues bankTitles on the bank folder once the builds this machine runs are here, installing nothing', async () => {
    const { queries, enqueued, installs, lines, warm } = fakeContainer(ALL);
    await warm('clap-general-text-fp16');
    expect(queries).toEqual([{ op: 'bankTitles', params: { bankDir: '/c/sfx-bank' } }]);
    // A low-priority listen job: the one-at-a-time listen lane and the 'gpu' slot, like every listening.
    expect(enqueued).toEqual([{ kind: 'audio.listen.query', priority: 'low' }]);
    expect(installs).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/sfx-bank titles ready for search \(246 in \d+ ms\)/);
  });

  it('skips with one line when the int8 build is installed while fp16 is the one chosen: no install, no job', async () => {
    const { queries, installs, lines, warm } = fakeContainer({
      'sfx-bank': 'installed',
      'clap-general-audio-fp16': 'installed',
      'clap-general-text': 'installed',
      'clap-general-text-fp16': 'not_installed',
    });
    await warm('clap-general-text');
    expect(installs).toEqual([]);
    expect(queries).toEqual([]);
    expect(lines).toEqual([
      '[listen] sfx-bank titles not warmed: clap-general-text-fp16 (not_installed) is not installed here; the first search makes them',
    ]);
  });

  it.each([
    ['the bank is missing', { ...ALL, 'sfx-bank': 'not_installed' }, 'sfx-bank (not_installed)'],
    ['a newer version waits', { ...ALL, 'clap-general-audio-fp16': 'update_available' }, 'update_available'],
    ['a new notice waits', { ...ALL, 'clap-general-text-fp16': 'notice_outdated' }, 'notice_outdated'],
  ] as const)('skips with one line when %s', async (_case, states, said) => {
    const { queries, installs, lines, warm } = fakeContainer(states);
    await warm('sfx-bank');
    expect(installs).toEqual([]);
    expect(queries).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(said);
  });

  it('ignores the no-op installs a model lookup reports, other installs, and a process without listening', async () => {
    const { queries, lines, warm } = fakeContainer(ALL);
    await warm('clap-general-audio-fp16', { installedAt: new Date(NOW - 3_600_000).toISOString() });
    await warm('whisper-small');
    expect(queries).toEqual([]);
    expect(lines).toEqual([]);
    const bare = warmListenTitles(createContainer(), { id: 'sfx-bank', ...JUST_NOW }, () => undefined);
    await expect(bare).resolves.toBeUndefined();
  });

  it('the jobs’ own model lookup asks for the build this machine runs by name', async () => {
    const { manager, installs } = components({});
    const container = createContainer()
      .value(EventBusToken, createEventBus({ clock: createManualClock(0) }))
      .value(ComponentVariantToken, METAL_PICK);
    const { jobs } = composeListen(container, testConfig('jobs'), {
      media: { binaries: async () => err(NotFoundError({ entity: 'ffmpeg', id: 'ffmpeg' })) } as never,
      components: () => manager,
      log: () => undefined,
    });
    const analysed = await createDirectJobRunner(jobs).run(audioListenAnalyseJob, {
      path: '/no/clip.wav',
      want: { tags: true },
    });
    expect(!analysed.ok && analysed.error.params).toEqual({ component: 'clap-general-audio' });
    expect(installs).toEqual(['clap-general-audio-fp16']);
    await container.dispose();
  });
});

describe('the signed manager’s pick, installing nothing', () => {
  const sha = 'a'.repeat(64);
  const entry = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    version: '1',
    kind: 'model',
    tiers: [],
    licence: { spdx: 'Apache-2.0', notice: { url: `https://c.example/${id}.txt`, size: 1, sha256: sha } },
    artifacts: [
      {
        platform: 'any',
        urls: [`https://c.example/${id}`],
        sha256: sha,
        size: 1,
        install: { type: 'file', fileName: id },
      },
    ],
    ...extra,
  });
  const manifest = unwrap(
    parseManifest({
      schemaVersion: 1,
      components: [
        entry('clap-general-text', { variants: ['clap-general-text-fp16'] }),
        entry('clap-general-text-fp16', { requires: { platform: 'darwin', gpuApi: 'metal' } }),
      ],
    }),
  );
  const metal: MachineDescription = { platform: 'darwin', arch: 'arm64', osVersion: '15.1', gpus: [] };

  it.each([
    ['a Metal Mac', ['metal'], 'clap-general-text-fp16'],
    ['TAALCUT_FORCE_CPU', [], 'clap-general-text'],
  ] as const)('names the build on %s; nothing is fetched or installed', async (_machine, apis, chosen) => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-listen-pick-'));
    const fetched: string[] = [];
    const manager = signedComponentManager({
      root: dir,
      manifestPath: join(dir, 'none.json'),
      release: true,
      manifest,
      fetch: (input) => (fetched.push(String(input)), Promise.reject(new Error('offline'))),
      log: () => undefined,
      machine: async () =>
        ok({ tier: 'minimum', machine: { ...metal, gpus: [{ vendor: 'apple', apis: [...apis] }] } }),
      platform: 'darwin-arm64',
    });
    try {
      expect(unwrap(await manager.variantOf('clap-general-text'))).toBe(chosen);
      expect((await manager.list()).filter((c) => c.state !== 'not_installed')).toEqual([]);
      expect(fetched).toEqual([]);
    } finally {
      await manager.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const mac: HardwareInfo = {
  platform: 'darwin',
  arch: 'arm64',
  chip: 'Apple M-series',
  memoryBytes: 32 * 1024 ** 3,
  gpus: [{ name: 'Apple GPU', vendor: 'apple', unifiedMemory: true, apis: ['metal'] }],
  neuralEngine: true,
  cpuCores: { total: 10 },
  freeDiskBytes: 1e12,
  osVersion: '15.1',
};

describe.skipIf(!MODELS || !existsSync(join(BANK, 'catalogue.json')))('with the real models (fp16)', () => {
  const pathOf = (id: string) => (id === 'sfx-bank' ? BANK : join(MODELS ?? '', id));

  /** One jobs process: the listen root over media's derived cache in `cacheRoot`. */
  function jobsProcess(cacheRoot: string) {
    const { manager, installs } = components(ALL, pathOf);
    const container = createContainer()
      .value(EventBusToken, createEventBus({ clock: createManualClock(0) }))
      .value(ComponentManagerToken, manager)
      .value(ComponentVariantToken, METAL_PICK);
    const { jobs } = composeListen(container, testConfig('jobs', ':memory:', join(root, 'user')), {
      media: { binaries: async () => ok({ ffmpeg: '', ffprobe: '' }) } as unknown as MediaService,
      components: () => manager,
      cache: createDerivedCache({ root: cacheRoot, capBytes: 1024 ** 3 }),
      hardware: async () => ({ info: mac }) as unknown as ProbedHardware,
      log: () => undefined,
    });
    const runner = createDirectJobRunner(jobs);
    container.value(JobRunnerToken, runner);
    const search = async (query: string) => {
      const t0 = performance.now();
      const found = await runner.run(audioListenQueryJob, {
        op: 'searchSounds',
        sources: [],
        params: { query, bankDir: BANK, top: 8 },
      });
      if (!found.ok) throw new Error(`${found.error.code}: ${found.error.detail ?? ''}`);
      const result = found.value.result as SearchSoundsResult;
      return { ms: performance.now() - t0, ids: result.hits.map((h) => h.id) };
    };
    const close = () => container.resolve(ListenServiceToken).release();
    return { container, installs, search, close };
  }

  it(
    'a restart reads the titles back; the warm-up leaves the first search nothing to make',
    {
      timeout: 600_000,
    },
    async () => {
      const query = 'a deep cinematic boom';
      const coldRoot = join(root, 'cold-cache');
      const first = jobsProcess(coldRoot);
      const cold = await first.search(query);
      await first.close();
      const restarted = jobsProcess(coldRoot);
      const restart = await restarted.search(query);
      await restarted.close();

      const warmedRoot = join(root, 'warmed-cache');
      const fresh = jobsProcess(warmedRoot);
      const t0 = performance.now();
      const installed = { id: 'clap-general-text-fp16', installedAt: new Date().toISOString() };
      await warmListenTitles(fresh.container, installed, () => undefined);
      const warmUp = performance.now() - t0;
      const afterWarmUp = await fresh.search(query);
      await fresh.close();

      const f = (ms: number) => `${ms.toFixed(0)} ms`;
      console.warn(
        `jobs root, bank titles: first search cold ${f(cold.ms)}; after a restart ${f(restart.ms)}; ` +
          `warm-up ${f(warmUp)}, then first search ${f(afterWarmUp.ms)}`,
      );
      const titleFiles = (dir: string) =>
        readdirSync(join(dir, 'listen'), { recursive: true }).filter((f) => String(f).includes('.titles.'));
      expect(titleFiles(coldRoot)).toHaveLength(1);
      expect(titleFiles(warmedRoot)).toHaveLength(1);
      // The jobs looked up the fp16 builds by name; nothing else was asked of the manager.
      expect(new Set(fresh.installs)).toEqual(new Set(['clap-general-audio-fp16', 'clap-general-text-fp16']));
      expect(restart.ids).toEqual(cold.ids);
      expect(afterWarmUp.ids).toEqual(cold.ids);
      expect(restart.ms).toBeLessThan(cold.ms / 2);
      expect(afterWarmUp.ms).toBeLessThan(cold.ms / 2);
    },
  );
});
