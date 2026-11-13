// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The listen spectrograms as in-memory ONNX graphs (media's `encodeOnnxModel`, like beats/mel-onnx.ts), on the
 * listen device plan: WebGPU first on a Mac, CUDA then WebGPU on Linux. `encodeOnnxModel` writes no attributes or
 * initializers, so framing stays in TypeScript and every matrix is a graph input:
 *
 * - a framed spectrogram: frames · basis (re, im) → power → [√] → [· projection] → [10·log10(· + 1e-12)];
 * - long single spectra (Welch's 65,536-point segments): a four-step FFT, two MatMuls of √N-point DFTs with the
 *   twiddles between, so no N×N basis is ever built.
 *
 * Shapes are static, so each graph runs on chunks of a fixed number of frames (the last zero-padded) and its
 * session is reused for the runner's life. A CPU session means no accelerator opened: media's runtime has logged
 * `compute.fallback` (operation `listen.frontend`), the session is released and the f64 oracle runs instead, once
 * decided for the whole runner, so one runner logs one fallback.
 */
import { computeFallbackEvent, cpuFallback, type ComputeFallbackEvent } from '@taalcut/core';
import {
  createOnnxRuntime,
  encodeOnnxModel,
  type OnnxGraph,
  type OnnxRuntimeOptions,
  type OnnxSession,
} from '@taalcut/media';
import { loadOnnxRuntime } from '../../beats/ort-load';
import { DEFAULT_LISTEN_PLAN, LISTEN_OPERATIONS, type ListenDevicePlan } from '../models/devices';
import { oracleSegmentPower, oracleSpectrogram } from './spectrogram-oracle';
import {
  basisOf,
  outputColumns,
  type FrameBlock,
  type SpectrogramResult,
  type SpectrogramSpec,
} from './transforms';

/** The `compute.fallback` operation of every listen spectrogram (EAR1 plan, GPU first). */
export const LISTEN_FRONTEND_OPERATION = LISTEN_OPERATIONS.frontEnd;

export interface SpectrogramRunnerOptions {
  /** Where the graphs run, best first: the models' listen device plan (the desktop passes the probe's). */
  readonly plan?: ListenDevicePlan;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  readonly loadModule?: OnnxRuntimeOptions['loadModule'];
  /** Frames per framed-graph run. Default 512. */
  readonly chunkFrames?: number;
  /** Run the graphs even on ORT's CPU provider (the graph tests); default: the f64 oracle on the CPU. */
  readonly cpuGraph?: boolean;
}

export interface SegmentPower {
  /** Row-major [count, n/2 + 1]. */
  readonly power: Float64Array;
  readonly backend: string;
}

export interface SpectrogramRunner {
  spectrogram(spec: SpectrogramSpec, block: FrameBlock): Promise<SpectrogramResult>;
  /** |rfft|² of `count` real segments of a power-of-two length `n` ≥ 1024 (row-major, already windowed). */
  segmentPower(segments: Float32Array, count: number, n: number): Promise<SegmentPower>;
  /** Where the graphs ran: undefined until the first run. */
  backend(): string | undefined;
  release(): Promise<void>;
}

interface OrtTensor {
  readonly data?: ArrayLike<number>;
  dispose?: () => void;
}

interface OrtNamespace {
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => OrtTensor;
}

export function framedGraph(chunk: number, length: number, bins: number, spec: SpectrogramSpec): OnnxGraph {
  const inputs = [
    { name: 'frames', dims: [chunk, length] },
    { name: 'basisRe', dims: [length, bins] },
    { name: 'basisIm', dims: [length, bins] },
  ];
  const nodes: Array<OnnxGraph['nodes'][number]> = [
    { op: 'MatMul', inputs: ['frames', 'basisRe'], outputs: ['re'] },
    { op: 'MatMul', inputs: ['frames', 'basisIm'], outputs: ['im'] },
    { op: 'Mul', inputs: ['re', 're'], outputs: ['re2'] },
    { op: 'Mul', inputs: ['im', 'im'], outputs: ['im2'] },
    { op: 'Add', inputs: ['re2', 'im2'], outputs: ['power'] },
  ];
  let value = 'power';
  if (spec.output === 'magnitude') {
    nodes.push({ op: 'Sqrt', inputs: ['power'], outputs: ['mag'] });
    value = 'mag';
  }
  if (spec.projection) {
    inputs.push({ name: 'projection', dims: [bins, spec.projection.columns] });
    nodes.push({ op: 'MatMul', inputs: [value, 'projection'], outputs: ['projected'] });
    value = 'projected';
  }
  if (spec.output === 'db') {
    inputs.push({ name: 'eps', dims: [1] }, { name: 'dbScale', dims: [1] });
    nodes.push(
      { op: 'Add', inputs: [value, 'eps'], outputs: ['floored'] },
      { op: 'Log', inputs: ['floored'], outputs: ['ln'] },
      { op: 'Mul', inputs: ['ln', 'dbScale'], outputs: ['db'] },
    );
    value = 'db';
  }
  nodes.push({ op: 'Identity', inputs: [value], outputs: ['out'] });
  return {
    name: `listen-${spec.id}`,
    inputs,
    outputs: [{ name: 'out', dims: [chunk, outputColumns(spec)] }],
    nodes,
  };
}

/** The four-step FFT power of [chunk, n1, n2] segments; out[s, k1, k2] = |X_s[k1 + n1·k2]|². */
export function fourStepGraph(chunk: number, n1: number, n2: number): OnnxGraph {
  const m = (a: string, b: string, out: string) => ({ op: 'MatMul', inputs: [a, b], outputs: [out] });
  const op = (kind: string, a: string, b: string, out: string) => ({
    op: kind,
    inputs: [a, b],
    outputs: [out],
  });
  return {
    name: 'listen-four-step',
    inputs: [
      { name: 'segments', dims: [chunk, n1, n2] },
      { name: 'f1Re', dims: [n1, n1] },
      { name: 'f1Im', dims: [n1, n1] },
      { name: 'twRe', dims: [n1, n2] },
      { name: 'twIm', dims: [n1, n2] },
      { name: 'f2Re', dims: [n2, n2] },
      { name: 'f2Im', dims: [n2, n2] },
    ],
    outputs: [{ name: 'out', dims: [chunk, n1, n2] }],
    nodes: [
      m('f1Re', 'segments', 'bRe'),
      m('f1Im', 'segments', 'bIm'),
      op('Mul', 'bRe', 'twRe', 'c1'),
      op('Mul', 'bIm', 'twIm', 'c2'),
      op('Sub', 'c1', 'c2', 'cRe'),
      op('Mul', 'bRe', 'twIm', 'c3'),
      op('Mul', 'bIm', 'twRe', 'c4'),
      op('Add', 'c3', 'c4', 'cIm'),
      m('cRe', 'f2Re', 'd1'),
      m('cIm', 'f2Im', 'd2'),
      op('Sub', 'd1', 'd2', 'dRe'),
      m('cRe', 'f2Im', 'd3'),
      m('cIm', 'f2Re', 'd4'),
      op('Add', 'd3', 'd4', 'dIm'),
      op('Mul', 'dRe', 'dRe', 'p1'),
      op('Mul', 'dIm', 'dIm', 'p2'),
      op('Add', 'p1', 'p2', 'out'),
    ],
  };
}

function dftMatrix(rows: number, cols: number, period: number): { re: Float32Array; im: Float32Array } {
  const re = new Float32Array(rows * cols);
  const im = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const angle = (2 * Math.PI * ((r * c) % period)) / period;
      re[r * cols + c] = Math.cos(angle);
      im[r * cols + c] = -Math.sin(angle);
    }
  }
  return { re, im };
}

/** n = n1·n2 with n1 ≥ n2, both powers of two. */
export function fourStepSplit(n: number): [number, number] {
  const p = Math.round(Math.log2(n));
  return [2 ** Math.ceil(p / 2), 2 ** Math.floor(p / 2)];
}

export function createSpectrogramRunner(options: SpectrogramRunnerOptions = {}): SpectrogramRunner {
  const plan = options.plan ?? DEFAULT_LISTEN_PLAN;
  const chunk = options.chunkFrames ?? 512;
  const load = options.loadModule ?? loadOnnxRuntime;
  const runtime = createOnnxRuntime({
    loadModule: load,
    logSeverityLevel: 3,
    ...(options.onFallback ? { onComputeFallback: options.onFallback } : {}),
    ...(plan.cudaDeviceId !== undefined ? { cuda: { deviceId: plan.cudaDeviceId } } : {}),
    ...(plan.cudaLibraries ? { libraries: plan.cudaLibraries } : {}),
  });
  const sessions = new Map<string, Promise<OnnxSession | undefined>>();
  const feeds = new Map<string, Record<string, OrtTensor>>();
  let cpu = false;
  let ran: string | undefined;

  const fallBack = (reason: 'no_accelerator' | 'accelerator_failed', detail: string) => {
    if (cpu) return;
    cpu = true;
    const choice = cpuFallback(reason, detail.slice(0, 500));
    if (choice.backend === 'cpu') {
      options.onFallback?.(
        computeFallbackEvent(LISTEN_FRONTEND_OPERATION, [...plan.devices], choice.fallback),
      );
    }
  };

  async function open(key: string, graph: () => OnnxGraph): Promise<OnnxSession | undefined> {
    if (cpu) return undefined;
    let pending = sessions.get(key);
    if (!pending) {
      pending = (async () => {
        const opened = await runtime.openSession(encodeOnnxModel(graph()), {
          operation: LISTEN_FRONTEND_OPERATION,
          candidates: [...plan.devices],
          ...(plan.cpuReason ? { cpuReason: plan.cpuReason } : {}),
        });
        if (!opened.ok) {
          fallBack('no_accelerator', opened.error.detail ?? opened.error.code);
          return undefined;
        }
        if (opened.value.backend === 'cpu' && !options.cpuGraph) {
          // The runtime logged the fallback; the oracle is faster than a DFT MatMul on the CPU.
          cpu = true;
          await opened.value.release();
          return undefined;
        }
        return opened.value;
      })();
      sessions.set(key, pending);
    }
    return pending;
  }

  async function tensor(data: Float32Array, dims: readonly number[]): Promise<OrtTensor> {
    const ort = (await load()) as unknown as OrtNamespace;
    return new ort.Tensor('float32', data, dims);
  }

  async function constants(key: string, make: () => Promise<Record<string, OrtTensor>>) {
    let hit = feeds.get(key);
    if (!hit) {
      hit = await make();
      feeds.set(key, hit);
    }
    return hit;
  }

  /** Runs `rows` rows of `rowLength` through the graph `step` rows at a time (the last slab zero-padded). */
  async function runChunks(
    session: OnnxSession,
    fixed: Record<string, OrtTensor>,
    input: {
      name: string;
      data: Float32Array;
      rows: number;
      rowLength: number;
      step: number;
      dims: number[];
    },
    outLength: number,
  ): Promise<Float32Array> {
    const out = new Float32Array(input.rows * outLength);
    for (let start = 0; start < input.rows; start += input.step) {
      const rows = Math.min(input.step, input.rows - start);
      const slab = new Float32Array(input.step * input.rowLength);
      slab.set(input.data.subarray(start * input.rowLength, (start + rows) * input.rowLength));
      const feed = await tensor(slab, input.dims);
      try {
        const result = await session.run({ ...fixed, [input.name]: feed });
        const value = result['out'] as OrtTensor | undefined;
        const data = value?.data;
        if (!data) throw new Error('graph output was missing');
        if (data instanceof Float32Array) out.set(data.subarray(0, rows * outLength), start * outLength);
        else for (let i = 0; i < rows * outLength; i++) out[start * outLength + i] = Number(data[i] ?? 0);
        value?.dispose?.();
      } finally {
        feed.dispose?.();
      }
    }
    return out;
  }

  return {
    backend: () => ran,
    async spectrogram(spec, block) {
      const columns = outputColumns(spec);
      if (block.count === 0) return { data: new Float32Array(0), frames: 0, columns, backend: ran ?? 'cpu' };
      const length = spec.frameLength;
      const basis = basisOf(spec);
      const key = `${spec.id}|${chunk}|${length}|${basis.bins}|${columns}|${spec.output}`;
      const session = await open(key, () => framedGraph(chunk, length, basis.bins, spec));
      if (!session) return oracleSpectrogram(spec, block);
      try {
        const fixed = await constants(key, async () => ({
          basisRe: await tensor(basis.re, [length, basis.bins]),
          basisIm: await tensor(basis.im, [length, basis.bins]),
          ...(spec.projection
            ? {
                projection: await tensor(Float32Array.from(spec.projection.data), [
                  basis.bins,
                  spec.projection.columns,
                ]),
              }
            : {}),
          ...(spec.output === 'db'
            ? {
                eps: await tensor(Float32Array.of(1e-12), [1]),
                dbScale: await tensor(Float32Array.of(10 / Math.LN10), [1]),
              }
            : {}),
        }));
        const data = await runChunks(
          session,
          fixed,
          {
            name: 'frames',
            data: block.frames,
            rows: block.count,
            rowLength: length,
            step: chunk,
            dims: [chunk, length],
          },
          columns,
        );
        ran = session.backend;
        return { data, frames: block.count, columns, backend: session.backend };
      } catch (cause) {
        fallBack('accelerator_failed', cause instanceof Error ? cause.message : String(cause));
        return oracleSpectrogram(spec, block);
      }
    },
    async segmentPower(segments, count, n) {
      const half = n / 2 + 1;
      const [n1, n2] = fourStepSplit(n);
      const per = Math.max(1, Math.floor(2 ** 20 / n));
      const key = `four-step|${per}|${n1}|${n2}`;
      const session = count > 0 ? await open(key, () => fourStepGraph(per, n1, n2)) : undefined;
      if (!session) return { power: oracleSegmentPower(segments, count, n), backend: 'cpu' };
      try {
        const fixed = await constants(key, async () => {
          const f1 = dftMatrix(n1, n1, n1);
          const f2 = dftMatrix(n2, n2, n2);
          const tw = dftMatrix(n1, n2, n);
          return {
            f1Re: await tensor(f1.re, [n1, n1]),
            f1Im: await tensor(f1.im, [n1, n1]),
            twRe: await tensor(tw.re, [n1, n2]),
            twIm: await tensor(tw.im, [n1, n2]),
            f2Re: await tensor(f2.re, [n2, n2]),
            f2Im: await tensor(f2.im, [n2, n2]),
          };
        });
        const raw = await runChunks(
          session,
          fixed,
          { name: 'segments', data: segments, rows: count, rowLength: n, step: per, dims: [per, n1, n2] },
          n,
        );
        const power = new Float64Array(count * half);
        for (let s = 0; s < count; s++) {
          for (let k = 0; k < half; k++) {
            const k1 = k % n1;
            const k2 = Math.floor(k / n1);
            power[s * half + k] = raw[s * n + k1 * n2 + k2] ?? 0;
          }
        }
        ran = session.backend;
        return { power, backend: session.backend };
      } catch (cause) {
        fallBack('accelerator_failed', cause instanceof Error ? cause.message : String(cause));
        return { power: oracleSegmentPower(segments, count, n), backend: 'cpu' };
      }
    },
    async release() {
      for (const tensors of feeds.values()) for (const t of Object.values(tensors)) t.dispose?.();
      feeds.clear();
      for (const pending of sessions.values()) await (await pending)?.release();
      sessions.clear();
    },
  };
}
