// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The listening models' ONNX sessions (EAR1-F4), opened lazily through media's `createOnnxRuntime` on the device
 * plan (devices.ts): the first device that opens, the CPU with a `compute.fallback`. Every run of one sessions
 * object is serialised. On a small machine (`singleResident`: the minimum tier, 8 GB) opening a model first
 * releases the others; any session nobody ran for `idleMs` (60 s) is released. The clock is injectable for tests.
 *
 * The spectrogram graphs run here too: once a graph would land on the CPU (or fails there), the front end stays on
 * the f64 oracle for this object's life, so the fallback is logged once.
 *
 * EAR1-R1:
 * - **Builds are looked up per call.** `model()` asks `files` every time, and a model that isn't open is looked up
 *   again when it opens, so a component update (which deletes the old version's folder) is what the next open
 *   reads. An open model whose build a later lookup replaced is closed and opened from the new one.
 * - **`installedOnly()`**: the same sessions (one queue, the same open models) over a lookup that never installs,
 *   for requests that say `install: false` (render QA): neither its `model()` nor its runs download anything.
 * - **`compute.fallback` once per operation** for this object's life, not at every reopen (after an idle release, or
 *   at each CLAP/AST switch on an 8 GB machine).
 */
import {
  CancelledError,
  computeFallbackEvent,
  cpuFallback,
  err,
  ok,
  type AsyncResult,
  type ComputeBackend,
  type ComputeFallbackEvent,
  type TaalcutError,
} from '@taalcut/core';
import { createOnnxRuntime, encodeOnnxModel, type OnnxSession } from '@taalcut/media';
import { LISTEN_CONFIG } from '../config';
import { ListenFailed, ListenModelMissing, ListenUnavailable } from '../errors';
import { DEFAULT_LISTEN_PLAN, LISTEN_OPERATIONS, type ListenDevicePlan } from './devices';
import {
  LISTEN_COMPONENTS,
  type ListenModelFiles,
  type ListenModelName,
  type ResolvedListenModel,
} from './files';
import { frontEndConstants, type FramedBatch, type FrontEndSpec } from './frontend-graph';
import { disposeAll, floatOutput, loadListenOrt, type ListenOrt, type ListenTensorType } from './ort';

export interface ListenTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ListenSessionsOptions {
  readonly files: ListenModelFiles;
  /** Asked once, at the first session (the desktop's: `listenDevicePlan` over the probe). */
  readonly plan?: () => Promise<ListenDevicePlan>;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  readonly loadModule?: () => Promise<ListenOrt>;
  /** Only one model open at a time (the minimum tier, 8 GB machines). */
  readonly singleResident?: boolean;
  readonly idleMs?: number;
  readonly timers?: ListenTimers;
  /** Where an idle release that failed is reported. */
  readonly log?: (line: string) => void;
}

export interface ListenInput {
  readonly type: ListenTensorType;
  readonly data: Float32Array | BigInt64Array;
  readonly dims: readonly number[];
}

export interface ListenSessions {
  /** The build that runs here (installed on demand): its component id and dtype. */
  model(name: ListenModelName, signal?: AbortSignal): AsyncResult<ResolvedListenModel>;
  /** One run of a model, opening it when needed. */
  run(
    name: ListenModelName,
    inputs: Readonly<Record<string, ListenInput>>,
    signal?: AbortSignal,
  ): AsyncResult<Readonly<Record<string, unknown>>>;
  /** A spectrogram graph on the GPU; undefined when the oracle should run instead. */
  frontEnd(spec: FrontEndSpec, framed: FramedBatch, signal?: AbortSignal): Promise<Float32Array | undefined>;
  /** Where an open model runs; undefined when it isn't open. */
  backend(name: ListenModelName): ComputeBackend | undefined;
  /** The models open now. */
  resident(): readonly ListenModelName[];
  release(): Promise<void>;
  /** These sessions over a lookup that never installs: only a build already here, else `listen_model_missing`. */
  installedOnly(): ListenSessions;
}

interface Slot {
  readonly session: OnnxSession;
  timer?: unknown;
  /** The model file it was opened from (graphs: none). */
  readonly path?: string;
}

type Lookup = (name: ListenModelName, signal?: AbortSignal) => AsyncResult<ResolvedListenModel>;

const OPERATION: Readonly<Record<ListenModelName, string>> = {
  clapAudio: LISTEN_OPERATIONS.clapAudio,
  clapText: LISTEN_OPERATIONS.clapText,
  ast: LISTEN_OPERATIONS.ast,
};

const defaultTimers: ListenTimers = {
  set(run, ms) {
    const handle = setTimeout(run, ms);
    handle.unref?.();
    return handle;
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const detailOf = (cause: unknown, fallback: string): string =>
  (cause instanceof Error ? cause.message : fallback).slice(0, 500);

function openError(error: TaalcutError): TaalcutError {
  if (error.code === 'media.onnx_unavailable') {
    return ListenUnavailable(
      { reason: 'onnx_runtime_missing' },
      error.detail ? { detail: error.detail } : {},
    );
  }
  return ListenFailed(undefined, { detail: (error.detail ?? error.code).slice(0, 500) });
}

/** The build already installed, never installing (`files.installed`; without it, nothing counts as installed). */
function installedLookup(files: ListenModelFiles): Lookup {
  return async (name) => {
    const found = await files.installed?.(name);
    return found ? ok(found) : err(ListenModelMissing({ component: LISTEN_COMPONENTS[name] }));
  };
}

export function createListenSessions(options: ListenSessionsOptions): ListenSessions {
  const idleMs = options.idleMs ?? LISTEN_CONFIG.sessions.idleMs;
  const timers = options.timers ?? defaultTimers;
  const log = options.log ?? (() => undefined);
  // Once per operation for this object's life: a reopen on the CPU is the same choice, already reported.
  const reported = new Set<string>();
  const onFallback = options.onFallback
    ? (event: ComputeFallbackEvent) => {
        if (reported.has(event.operation)) return;
        reported.add(event.operation);
        options.onFallback?.(event);
      }
    : undefined;
  let planned: Promise<ListenDevicePlan> | undefined;
  const plan = () => (planned ??= options.plan ? options.plan() : Promise.resolve(DEFAULT_LISTEN_PLAN));
  let loaded: Promise<ListenOrt> | undefined;
  const ort = () => (loaded ??= (options.loadModule ?? loadListenOrt)());
  let runtime: Promise<ReturnType<typeof createOnnxRuntime>> | undefined;
  const onnx = () =>
    (runtime ??= plan().then((chosen) =>
      createOnnxRuntime({
        loadModule: ort,
        // Errors only: the exported graphs carry initializers ORT warns about on every open.
        logSeverityLevel: 3,
        ...(onFallback ? { onComputeFallback: onFallback } : {}),
        ...(chosen.cudaDeviceId !== undefined ? { cuda: { deviceId: chosen.cudaDeviceId } } : {}),
        ...(chosen.cudaLibraries ? { libraries: chosen.cudaLibraries } : {}),
      }),
    ));
  const models = new Map<ListenModelName, Slot>();
  const graphs = new Map<string, Slot>();
  /** The build each model's last lookup found: an open model from another build is reopened from it. */
  const latest = new Map<ListenModelName, string>();
  let frontEndCpu = false;
  let queue: Promise<unknown> = Promise.resolve();

  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };

  const drop = async (map: Map<string, Slot> | Map<ListenModelName, Slot>, key: string): Promise<void> => {
    const slot = (map as Map<string, Slot>).get(key);
    if (!slot) return;
    (map as Map<string, Slot>).delete(key);
    if (slot.timer !== undefined) timers.clear(slot.timer);
    await slot.session.release();
  };

  const arm = (map: Map<string, Slot>, key: string, slot: Slot): void => {
    if (slot.timer !== undefined) timers.clear(slot.timer);
    slot.timer = timers.set(() => {
      exclusive(async () => {
        if (map.get(key) === slot) await drop(map, key);
      }).catch((cause: unknown) =>
        log(`[listen] idle release of ${key} failed: ${detailOf(cause, 'unknown')}`),
      );
    }, idleMs);
  };

  const candidates = async () => {
    const chosen = await plan();
    return { candidates: [...chosen.devices], ...(chosen.cpuReason ? { cpuReason: chosen.cpuReason } : {}) };
  };

  /** A lookup that remembers what it found, so an open model from an older build is noticed. */
  const remembering =
    (lookup: Lookup): Lookup =>
    async (name, signal) => {
      const found = await lookup(name, signal);
      if (found.ok) latest.set(name, found.value.modelPath);
      return found;
    };
  const installing = remembering((name, signal) => options.files.resolve(name, signal));
  const installedOnly = remembering(installedLookup(options.files));

  async function open(name: ListenModelName, lookup: Lookup, signal?: AbortSignal): AsyncResult<Slot> {
    const existing = models.get(name);
    if (existing && existing.path === latest.get(name)) return ok(existing);
    // Not open, or opened from a build a later lookup replaced: looked up now, so a deleted folder isn't read.
    if (existing) await drop(models, name);
    const file = await lookup(name, signal);
    if (!file.ok) return file;
    if (options.singleResident) for (const other of [...models.keys()]) await drop(models, other);
    const opened = await (
      await onnx()
    ).openSession(file.value.modelPath, { operation: OPERATION[name], ...(await candidates()) });
    if (!opened.ok) return err(openError(opened.error));
    const slot: Slot = { session: opened.value, path: file.value.modelPath };
    models.set(name, slot);
    return ok(slot);
  }

  async function tensors(inputs: Readonly<Record<string, ListenInput>>): Promise<Record<string, unknown>> {
    const { Tensor } = await ort();
    return Object.fromEntries(
      Object.entries(inputs).map(([key, input]) => [key, new Tensor(input.type, input.data, input.dims)]),
    );
  }

  function toCpu(reason: 'no_accelerator' | 'accelerator_failed', detail: string, wanted: string[]): void {
    frontEndCpu = true;
    const choice = cpuFallback(reason, detail.slice(0, 500));
    if (choice.backend === 'cpu') {
      onFallback?.(
        computeFallbackEvent(LISTEN_OPERATIONS.frontEnd, wanted as ComputeBackend[], choice.fallback),
      );
    }
  }

  async function graphSlot(spec: FrontEndSpec, rows: number): Promise<Slot | undefined> {
    const key = `${spec.key}:${rows}`;
    const existing = graphs.get(key);
    if (existing) return existing;
    const request = await candidates();
    const opened = await (
      await onnx()
    ).openSession(encodeOnnxModel(spec.graph(rows)), { operation: LISTEN_OPERATIONS.frontEnd, ...request });
    if (!opened.ok) {
      if (opened.error.code === 'media.onnx_unavailable') {
        toCpu(
          'no_accelerator',
          opened.error.detail ?? 'onnxruntime-node is not installed',
          request.candidates,
        );
      } else frontEndCpu = true;
      return undefined;
    }
    if (opened.value.backend === 'cpu') {
      // The runtime logged this fallback; the f64 oracle is faster and exact on the CPU.
      frontEndCpu = true;
      await opened.value.release();
      return undefined;
    }
    const slot: Slot = { session: opened.value };
    graphs.set(key, slot);
    return slot;
  }

  async function runGraph(spec: FrontEndSpec, framed: FramedBatch): Promise<Float32Array | undefined> {
    if (frontEndCpu) return undefined;
    const slot = await graphSlot(spec, framed.rows);
    if (!slot) return undefined;
    const key = `${spec.key}:${framed.rows}`;
    if (slot.timer !== undefined) timers.clear(slot.timer);
    const inputs: Record<string, ListenInput> = {
      frames: { type: 'float32', data: framed.frames, dims: [framed.rows, spec.frameLength] },
    };
    for (const [name, constant] of Object.entries(frontEndConstants(spec))) {
      inputs[name] = { type: 'float32', data: constant.data, dims: constant.dims };
    }
    const feeds = await tensors(inputs);
    try {
      const out = floatOutput(await slot.session.run(feeds), slot.session.outputNames[0] ?? '');
      if (out && out.length >= framed.rows * spec.width) return out;
      toCpu('accelerator_failed', `${slot.session.backend} ${spec.key} front end gave no output`, [
        slot.session.backend,
      ]);
    } catch (cause) {
      toCpu('accelerator_failed', detailOf(cause, `${spec.key} front end failed`), [slot.session.backend]);
    } finally {
      disposeAll(feeds);
      if (graphs.get(key) === slot) arm(graphs, key, slot);
    }
    for (const other of [...graphs.keys()]) await drop(graphs, other);
    return undefined;
  }

  const facade = (lookup: Lookup): ListenSessions => ({
    model: (name, signal) => lookup(name, signal),
    run(name, inputs, signal) {
      return exclusive(async () => {
        if (signal?.aborted) return err(CancelledError());
        const slot = await open(name, lookup, signal);
        if (!slot.ok) return slot;
        if (slot.value.timer !== undefined) timers.clear(slot.value.timer);
        const feeds = await tensors(inputs);
        try {
          return ok(await slot.value.session.run(feeds));
        } catch (cause) {
          return err(ListenFailed(undefined, { detail: detailOf(cause, `${OPERATION[name]} run failed`) }));
        } finally {
          disposeAll(feeds);
          if (models.get(name) === slot.value) arm(models as Map<string, Slot>, name, slot.value);
        }
      });
    },
    frontEnd(spec, framed, signal) {
      return exclusive(async () => (signal?.aborted ? undefined : runGraph(spec, framed)));
    },
    backend: (name) => models.get(name)?.session.backend,
    resident: () => [...models.keys()],
    release() {
      return exclusive(async () => {
        for (const name of [...models.keys()]) await drop(models, name);
        for (const key of [...graphs.keys()]) await drop(graphs, key);
      });
    },
    installedOnly: () => offline,
  });
  const offline = facade(installedOnly);
  return facade(installing);
}
