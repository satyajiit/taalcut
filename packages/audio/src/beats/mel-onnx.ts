// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Log-mel on the plan's GPU (CUDA or WebGPU, devices.ts). `encodeOnnxModel` has no attributes or initializers, so
 * the reflect pad stays in TypeScript and the DFT basis is a graph input. A CPU session is logged by the runtime;
 * this file then uses the f64 oracle.
 */
import { computeFallbackEvent, cpuFallback, type ComputeFallbackEvent } from '@taalcut/core';
import { encodeOnnxModel, type OnnxGraph } from '@taalcut/media';
import { AUDIO_CONFIG } from '../config';
import { DEFAULT_BEAT_PLAN } from './devices';
import { beatFrontEndGraph, onsetOf, stftFrames } from './graph';
import { beatOnnxRuntime } from './ort';
import type { BeatDevicePlan } from './types';

const { nFft, nMels, nFreq } = AUDIO_CONFIG.beats;

export interface LogMel {
  readonly logMel: Float32Array;
  readonly frames: number;
  readonly onset: Float32Array;
}

interface OrtTensor {
  readonly data?: ArrayLike<number>;
  dispose?: () => void;
}

interface OrtNamespace {
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => OrtTensor;
}

let basisCache: { real: Float32Array; imag: Float32Array } | undefined;

function basis(): { real: Float32Array; imag: Float32Array } {
  if (basisCache) return basisCache;
  const scale = Math.sqrt(nFft);
  const real = new Float32Array(nFft * nFreq);
  const imag = new Float32Array(nFft * nFreq);
  for (let n = 0; n < nFft; n++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / nFft);
    for (let k = 0; k < nFreq; k++) {
      const angle = (2 * Math.PI * k * n) / nFft;
      const index = n * nFreq + k;
      real[index] = (window * Math.cos(angle)) / scale;
      imag[index] = (-window * Math.sin(angle)) / scale;
    }
  }
  basisCache = { real, imag };
  return basisCache;
}

function graphFor(frames: number): OnnxGraph {
  return {
    name: 'logmel',
    inputs: [
      { name: 'frames', dims: [frames, nFft] },
      { name: 'basisReal', dims: [nFft, nFreq] },
      { name: 'basisImag', dims: [nFft, nFreq] },
      { name: 'bank', dims: [nFreq, nMels] },
      { name: 'one', dims: [1] },
    ],
    outputs: [{ name: 'logMel', dims: [frames, nMels] }],
    nodes: [
      { op: 'MatMul', inputs: ['frames', 'basisReal'], outputs: ['re'] },
      { op: 'MatMul', inputs: ['frames', 'basisImag'], outputs: ['im'] },
      { op: 'Mul', inputs: ['re', 're'], outputs: ['re2'] },
      { op: 'Mul', inputs: ['im', 'im'], outputs: ['im2'] },
      { op: 'Add', inputs: ['re2', 'im2'], outputs: ['power'] },
      { op: 'Sqrt', inputs: ['power'], outputs: ['mag'] },
      { op: 'MatMul', inputs: ['mag', 'bank'], outputs: ['mel'] },
      { op: 'Add', inputs: ['mel', 'one'], outputs: ['mel1'] },
      { op: 'Log', inputs: ['mel1'], outputs: ['logMel'] },
    ],
  };
}

function scaledBank(filterbank: Float32Array): Float32Array {
  const bank = new Float32Array(filterbank.length);
  for (let i = 0; i < filterbank.length; i++) bank[i] = (filterbank[i] ?? 0) * 1000;
  return bank;
}

function logCpu(
  onFallback: ((event: ComputeFallbackEvent) => void) | undefined,
  reason: 'no_accelerator' | 'accelerator_failed',
  detail: string,
  wanted: readonly BeatDevicePlan['devices'][number][] = ['webgpu', 'cpu'],
): void {
  const choice = cpuFallback(reason, detail.slice(0, 500));
  if (choice.backend === 'cpu') {
    onFallback?.(computeFallbackEvent('audio.beatFrontEnd', [...wanted], choice.fallback));
  }
}

function copyMel(value: unknown, length: number): Float32Array | undefined {
  if (!value || typeof value !== 'object' || !('data' in value)) return undefined;
  const data = (value as { data?: ArrayLike<number> }).data;
  if (!data) return undefined;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = Number(data[i] ?? 0);
  return out;
}

async function tensors(
  frames: Float32Array,
  nFrames: number,
  filterbank: Float32Array,
): Promise<Record<string, OrtTensor>> {
  const ort = (await import('onnxruntime-node')) as unknown as OrtNamespace;
  const { real, imag } = basis();
  return {
    frames: new ort.Tensor('float32', frames, [nFrames, nFft]),
    basisReal: new ort.Tensor('float32', real, [nFft, nFreq]),
    basisImag: new ort.Tensor('float32', imag, [nFft, nFreq]),
    bank: new ort.Tensor('float32', scaledBank(filterbank), [nFreq, nMels]),
    one: new ort.Tensor('float32', Float32Array.of(1), [1]),
  };
}

function dispose(feeds: Record<string, OrtTensor>): void {
  for (const tensor of Object.values(feeds)) tensor.dispose?.();
}

/** Log-mel on the plan's GPU, or undefined when the runtime already logged a CPU fallback. */
async function gpuLogMel(
  samples: Float32Array,
  filterbank: Float32Array,
  onFallback: ((event: ComputeFallbackEvent) => void) | undefined,
  plan: BeatDevicePlan,
): Promise<LogMel | undefined> {
  const frames = stftFrames(samples);
  const nFrames = frames.length / nFft;
  const opened = await beatOnnxRuntime(plan, onFallback).openSession(encodeOnnxModel(graphFor(nFrames)), {
    operation: 'audio.beatFrontEnd',
    candidates: [...plan.devices],
    ...(plan.cpuReason ? { cpuReason: plan.cpuReason } : {}),
  });
  if (!opened.ok) {
    if (opened.error.code === 'media.onnx_unavailable') {
      const detail = opened.error.detail ?? 'onnxruntime-node is not installed';
      logCpu(onFallback, 'no_accelerator', detail, plan.devices);
    }
    return undefined;
  }
  const device = opened.value.backend;
  if (device === 'cpu') {
    await opened.value.release();
    return undefined;
  }
  const feeds = await tensors(frames, nFrames, filterbank);
  try {
    const outputs = await opened.value.run(feeds);
    const mel = copyMel(outputs.logMel, nFrames * nMels);
    if (!mel) {
      logCpu(onFallback, 'accelerator_failed', `${device} log-mel output was missing`, plan.devices);
      return undefined;
    }
    return { logMel: mel, frames: nFrames, onset: onsetOf(mel, nFrames) };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : `${device} log-mel run failed`;
    logCpu(onFallback, 'accelerator_failed', detail, plan.devices);
    return undefined;
  } finally {
    dispose(feeds);
    await opened.value.release();
  }
}

export async function runLogMel(
  samples: Float32Array,
  filterbank: Float32Array,
  onFallback?: (event: ComputeFallbackEvent) => void,
  plan: BeatDevicePlan = DEFAULT_BEAT_PLAN,
): Promise<LogMel> {
  const gpu = await gpuLogMel(samples, filterbank, onFallback, plan);
  if (gpu) return gpu;
  return beatFrontEndGraph(filterbank).run(samples);
}
