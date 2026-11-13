// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The download of everything this Mac needs, as the jobs process runs it (UX2-DOWNLOADER), for the preview and the
 * renderer's tests: `system.downloads`, the `components.downloads` event on every change, and the four commands
 * (download with what goes first, pause, resume, cancel). Three lanes, the largest part first and the rest
 * smallest first; a part waits for the parts it needs; a failure doesn't stop the others; a disk too full refuses
 * to start (jobs.downloads_space_low). A tick is eight seconds of a real download (64 MB a lane at 8 MB/s).
 *
 * Scenarios: a fresh Mac has nothing (first run starts it); a finished first run has everything; `models: 'missing'`
 * is a Mac whose speech and search models aren't here and nothing is fetching them; `models: 'broken'` is that Mac
 * with Whisper tiny failing half way (jobs.size_mismatch); `downloads: 'midway'` is a download under way (some
 * here, three in lanes, one reconnecting) and `'paused'` the same, paused.
 */
import {
  COMPONENT_COMMANDS,
  componentCommandPayloads,
  defineCommand,
  err,
  ok,
  ValidationError,
  type AnyCommand,
  type Component,
  type Downloads,
  type DownloadStep,
  type PublicError,
} from '@taalcut/core';
import { FAKE_PARTS, fakeOrder, partComponent, type FakePart } from './fake-downloads-data';
import { withWanted, type FakeWanted } from './fake-speech';
import { heldComponent, type FakeHeld } from './fake-nvidia';

export type FakeModels = 'missing' | 'broken';
export type FakeDownloadsScenario = 'midway' | 'paused';

export interface FakeDownloadsOptions {
  /** First run finished: everything this Mac needs is here (unless `models` says otherwise). */
  readonly installed: boolean;
  /** Milliseconds between ticks; 0 finishes at once. */
  readonly tick: number;
  readonly models?: FakeModels;
  readonly scenario?: FakeDownloadsScenario;
  readonly freeBytes: () => number;
  readonly now: () => number;
  readonly emit: (downloads: Downloads) => void;
  /** LNX1-TRM: a part held back until its owner's terms are accepted (fake-nvidia.ts); joins once they are. */
  readonly held?: FakeHeld | undefined;
  /** LIB1-LANG: the parts the person's choices ask for now (the Indian-language identifier: fake-speech.ts). */
  readonly wanted?: () => readonly FakeWanted[];
}

export interface FakeDownloads {
  downloads(): Downloads;
  /** The parts by id, as they are now (system.components shows them). */
  part(id: string): Component | undefined;
  readonly commands: AnyCommand[];
}

type PartStatus = 'installed' | 'downloading' | 'queued' | 'paused' | 'missing' | 'failed';

interface PartState {
  readonly part: FakePart;
  status: PartStatus;
  bytesDone: number;
  step?: DownloadStep;
  retryAt?: number;
  error?: PublicError;
}

const LANES = 3;
const LANE_BYTES_PER_TICK = 64 * 1000 ** 2;
/** What a lane's tick stands for: eight seconds at 8 MB/s. */
const LANE_BYTES_PER_SECOND = 8 * 1000 ** 2;
const HEADROOM_BYTES = 512 * 1024 ** 2;
/** The indexing models a clip waits for (`models`). */
const INDEXING = new Set(['whisper-tiny', 'embeddinggemma-2', 'embeddinggemma-2-coreml']);
const BROKEN = 'whisper-tiny';

const STATUS_OF: Record<PartStatus, Component['status']> = {
  installed: 'installed',
  downloading: 'downloading',
  queued: 'queued',
  paused: 'paused',
  missing: 'not-installed',
  failed: 'failed',
};

function sizeMismatch(part: FakePart): PublicError {
  return {
    code: 'jobs.size_mismatch',
    messageKey: 'errors.jobs.size_mismatch',
    retryable: true,
    params: { component: part.id, expectedBytes: part.sizeBytes, actualBytes: 9 },
  };
}

/** Where each part starts: `installed` and `models` decide; 'midway' and 'paused' put a download under way. */
function startingParts(options: FakeDownloadsOptions): PartState[] {
  const parts = fakeOrder(FAKE_PARTS).map((part): PartState => {
    const here = options.installed && !(options.models && INDEXING.has(part.id));
    return { part, status: here ? 'installed' : 'missing', bytesDone: here ? part.sizeBytes : 0 };
  });
  if (!options.scenario) return parts;
  const at = (id: string) => parts.find((each) => each.part.id === id);
  for (const id of ['whisper-cpp', 'whisper-server', 'onnxruntime', 'silero-vad', 'sfx-pack']) {
    const state = at(id);
    if (state) Object.assign(state, { status: 'installed', bytesDone: state.part.sizeBytes });
  }
  const paused = options.scenario === 'paused';
  const lane = (id: string, fraction: number, extra: Partial<PartState> = {}) => {
    const state = at(id);
    if (state)
      Object.assign(state, {
        status: paused ? 'paused' : 'downloading',
        bytesDone: Math.round(state.part.sizeBytes * fraction),
        ...(paused ? {} : { step: 'downloading' }),
        ...(paused ? {} : extra),
      });
  };
  lane('local-llm-qwen3-5-4b', 0.42);
  lane('embeddinggemma-2', 0.64);
  lane('beat-this', 0.2, { step: 'reconnecting', retryAt: options.now() + 8000 });
  for (const state of parts) if (state.status === 'missing') state.status = paused ? 'paused' : 'queued';
  return parts;
}

export function createFakeDownloads(options: FakeDownloadsOptions): FakeDownloads {
  let parts = startingParts(options);
  let requested = options.scenario !== undefined;
  let paused = options.scenario === 'paused';
  let setError: PublicError | undefined;
  let batch = new Set(options.scenario ? parts.map((each) => each.part.id) : []);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const broken = options.models === 'broken' ? BROKEN : undefined;
  const held = options.held;
  let admitted = false;
  /** LIB1-LANG: the parts the person's choices want, as the jobs process re-plans (fake-speech.ts). */
  const want = () => {
    parts = withWanted(parts, options.wanted?.() ?? [], {
      fixed: (part) => FAKE_PARTS.includes(part) || part === held?.part,
      join: ({ part, fromStart }) => {
        const here = fromStart && options.installed;
        return { part, status: here ? 'installed' : 'missing', bytesDone: here ? part.sizeBytes : 0 };
      },
    });
  };
  /** The held part joins the download once its terms are accepted, as the jobs process re-plans. */
  const admit = () => {
    want();
    if (admitted || !held?.accepted()) return;
    admitted = true;
    parts.push({ part: held.part, status: 'missing', bytesDone: 0 });
  };
  const known = () => parts.map((each) => each.part);

  const active = () => parts.filter((each) => each.status === 'downloading');
  const left = () =>
    parts.reduce(
      (sum, each) => sum + (each.status === 'installed' ? 0 : each.part.sizeBytes - each.bytesDone),
      0,
    );
  /** The engine's check: what is still to download, every archive still to unpack, and the headroom. */
  const required = () =>
    left() +
    parts.reduce((sum, each) => sum + (each.status === 'installed' ? 0 : (each.part.unpackedBytes ?? 0)), 0) +
    HEADROOM_BYTES;

  function state(): Downloads['state'] {
    if (parts.every((each) => each.status === 'installed')) return 'ready';
    if (parts.some((each) => each.status === 'downloading' || each.status === 'queued')) return 'downloading';
    if (paused && requested) return 'paused';
    if (setError || parts.some((each) => each.status === 'failed')) return 'failed';
    return 'missing';
  }

  function component(each: PartState): Component {
    const base =
      held && each.part.id === held.part.id
        ? heldComponent(held, STATUS_OF[each.status], true)
        : partComponent(each.part, STATUS_OF[each.status]);
    const partial = each.status !== 'installed' && each.bytesDone > 0 ? { bytesDone: each.bytesDone } : {};
    if (each.status !== 'downloading')
      return { ...base, ...partial, ...(each.error ? { error: each.error } : {}) };
    const moving = each.step === 'downloading' || each.step === 'resuming';
    return {
      ...base,
      bytesDone: each.bytesDone,
      progress: each.bytesDone / each.part.sizeBytes,
      step: each.step ?? 'downloading',
      ...(moving ? { bytesPerSecond: LANE_BYTES_PER_SECOND } : {}),
      ...(moving
        ? { etaMs: Math.ceil(((each.part.sizeBytes - each.bytesDone) / LANE_BYTES_PER_SECOND) * 1000) }
        : {}),
      ...(each.retryAt === undefined ? {} : { retryAt: each.retryAt }),
    };
  }

  function downloads(): Downloads {
    admit();
    const components = parts.map(component);
    const count = (status: PartStatus) => parts.filter((each) => each.status === status).length;
    const counted = parts.filter((each) =>
      batch.size > 0 ? batch.has(each.part.id) : each.status !== 'installed',
    );
    const bytesTotal = counted.reduce((sum, each) => sum + each.part.sizeBytes, 0);
    const bytesDone = counted.reduce((sum, each) => sum + each.bytesDone, 0);
    const now = state();
    const moving = active().filter((each) => each.step === 'downloading' || each.step === 'resuming');
    const bytesPerSecond = now === 'downloading' ? moving.length * LANE_BYTES_PER_SECOND : 0;
    const rest = left();
    return {
      state: now,
      components,
      counts: {
        installed: count('installed'),
        downloading: count('downloading'),
        queued: count('queued'),
        paused: count('paused'),
        failed: count('failed'),
        missing: count('missing'),
      },
      bytesTotal,
      bytesDone,
      bytesPerSecond,
      ...(bytesPerSecond > 0 ? { etaMs: Math.ceil(((bytesTotal - bytesDone) / bytesPerSecond) * 1000) } : {}),
      requiredBytes: rest > 0 ? required() : 0,
      freeBytes: options.freeBytes(),
      ...(setError && now !== 'ready' ? { error: setError } : {}),
      ...(held && !admitted
        ? {
            awaitingTerms: [
              { component: heldComponent(held, 'not-installed', false), unlocks: [...held.unlocks] },
            ],
          }
        : {}),
    };
  }

  const changed = () => options.emit(downloads());

  /** One tick of every lane, then the free lanes take the next parts whose needs are here. */
  function advance(): void {
    for (const each of active()) {
      if (each.step === 'reconnecting') {
        if ((each.retryAt ?? 0) <= options.now())
          Object.assign(each, { step: 'resuming', retryAt: undefined });
        continue;
      }
      if (each.step === 'verifying') {
        Object.assign(each, { status: 'installed', step: undefined, bytesDone: each.part.sizeBytes });
        continue;
      }
      const next = Math.min(each.part.sizeBytes, each.bytesDone + LANE_BYTES_PER_TICK);
      if (each.part.id === broken && next >= each.part.sizeBytes / 2) {
        Object.assign(each, {
          status: 'failed',
          step: undefined,
          bytesDone: 0,
          error: sizeMismatch(each.part),
        });
        continue;
      }
      Object.assign(each, {
        bytesDone: next,
        step: next >= each.part.sizeBytes ? 'verifying' : 'downloading',
      });
    }
    fillLanes();
  }

  function fillLanes(): void {
    for (const each of parts) {
      if (each.status !== 'queued') continue;
      const needs = (each.part.needs ?? []).map((id) => parts.find((other) => other.part.id === id));
      const failed = needs.find((need) => need?.status === 'failed');
      if (failed?.error) Object.assign(each, { status: 'failed', error: failed.error });
      else if (active().length < LANES && needs.every((need) => !need || need.status === 'installed'))
        Object.assign(each, { status: 'downloading', step: each.bytesDone > 0 ? 'resuming' : 'downloading' });
    }
  }

  function run(): void {
    clearTimeout(timer);
    if (options.tick === 0) {
      while (state() === 'downloading') advance();
      changed();
      return;
    }
    const step = () => {
      advance();
      changed();
      if (state() === 'downloading') timer = setTimeout(step, options.tick);
    };
    timer = setTimeout(step, options.tick);
  }

  function start(first: readonly string[] | undefined) {
    admit();
    const outside = (first ?? []).filter((id) => !parts.some((each) => each.part.id === id));
    if (outside.length > 0) return err(ValidationError({ field: 'first' }));
    requested = true;
    paused = false;
    const need = required();
    if (left() > 0 && options.freeBytes() < need) {
      setError = {
        code: 'jobs.downloads_space_low',
        messageKey: 'errors.jobs.downloads_space_low',
        retryable: false,
        params: { requiredBytes: need, availableBytes: options.freeBytes() },
        fix: { command: 'system.openStorage', labelKey: 'fix.openStorageSettings' },
      };
      changed();
      return err(setError);
    }
    setError = undefined;
    const order = fakeOrder(known(), first).map((part) => part.id);
    parts = order.flatMap((id) => parts.filter((each) => each.part.id === id));
    for (const each of parts) {
      if (each.status === 'installed' || each.status === 'downloading') continue;
      batch.add(each.part.id);
      Object.assign(each, { status: 'queued', error: undefined, step: undefined });
    }
    fillLanes();
    changed();
    run();
    return ok({ result: { state: state() } });
  }

  const shared = { sideEffect: 'write', project: () => null } as const;
  const commands: AnyCommand[] = [
    defineCommand({
      ...shared,
      name: COMPONENT_COMMANDS.download,
      payload: componentCommandPayloads[COMPONENT_COMMANDS.download],
      handle: async ({ first }) => start(first),
    }),
    defineCommand({
      ...shared,
      name: COMPONENT_COMMANDS.resumeDownloads,
      payload: componentCommandPayloads[COMPONENT_COMMANDS.resumeDownloads],
      handle: async () => start(undefined),
    }),
    defineCommand({
      ...shared,
      name: COMPONENT_COMMANDS.pauseDownloads,
      payload: componentCommandPayloads[COMPONENT_COMMANDS.pauseDownloads],
      handle: async () => {
        clearTimeout(timer);
        paused = true;
        for (const each of parts)
          if (each.status === 'downloading' || each.status === 'queued')
            Object.assign(each, { status: 'paused', step: undefined, retryAt: undefined });
        changed();
        return ok({ result: { state: state() } });
      },
    }),
    defineCommand({
      ...shared,
      name: COMPONENT_COMMANDS.cancelDownloads,
      payload: componentCommandPayloads[COMPONENT_COMMANDS.cancelDownloads],
      handle: async () => {
        clearTimeout(timer);
        requested = false;
        paused = false;
        setError = undefined;
        batch = new Set();
        for (const each of parts)
          if (each.status !== 'installed')
            Object.assign(each, {
              status: 'missing',
              bytesDone: 0,
              step: undefined,
              retryAt: undefined,
              error: undefined,
            });
        changed();
        return ok({ result: { state: state() } });
      },
    }),
  ];

  // A download under way when the page opens goes on by itself, as the jobs process's restore does.
  if (state() === 'downloading') run();

  return {
    downloads,
    part: (id) => {
      admit();
      if (held && !admitted && id === held.part.id) return heldComponent(held, 'not-installed', false);
      const found = parts.find((each) => each.part.id === id);
      return found ? component(found) : undefined;
    },
    commands,
  };
}
