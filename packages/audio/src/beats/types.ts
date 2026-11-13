// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Beat This! session. `createOrtBeatRuntime` opens it with media's
 * `createOnnxRuntime`. Jobs inject a fake with the same shape.
 */
import type { AsyncResult, BeatMap, ComputeFallbackReason, FrameRate } from '@taalcut/core';
import type { LibrarySearch } from '@taalcut/media';

export const BEAT_FLAGS = ['low_confidence', 'tempo_disagrees', 'few_downbeats'] as const;
export type BeatFlag = (typeof BEAT_FLAGS)[number];

export interface BeatEnvelope {
  /** 50/1: one peak sample per log-mel frame. */
  readonly rate: FrameRate;
  readonly peaks: readonly number[];
}

export interface BeatAnalysis {
  readonly beatMap: BeatMap;
  readonly downbeatSource: 'model' | 'inferred';
  readonly flags: readonly BeatFlag[];
  readonly envelope: BeatEnvelope;
  readonly model: string;
}

export interface BeatSpectInput {
  readonly data: Float32Array;
  /** [windows, 1500, 128], row-major. */
  readonly dims: readonly [number, number, number];
}

export interface BeatModelOutput {
  readonly beat: Float32Array;
  readonly downbeat: Float32Array;
}

/** The execution providers Beat This! runs on (devices.ts). */
export type BeatDevice = 'cuda' | 'directml' | 'webgpu' | 'cpu';

/** Where a runtime opens its sessions, best first, from the probe (`beatDevicePlan`). */
export interface BeatDevicePlan {
  readonly devices: readonly BeatDevice[];
  /** The CUDA session's device (the probe's CUDA ordinal). */
  readonly cudaDeviceId?: number;
  /** Why the CPU alone, when the machine runs none of the rows: `disabled` (TAALCUT_FORCE_CPU) or `no_accelerator`. */
  readonly cpuReason?: {
    readonly reason: ComputeFallbackReason;
    readonly detail: string;
    readonly wanted: readonly BeatDevice[];
  };
  /** Where a CUDA failure's missing libraries are looked for: the desktop names the installed cuda-runtime-13. */
  readonly cudaLibraries?: LibrarySearch;
}

export interface BeatOnnxSession {
  readonly backend: BeatDevice;
  run(input: BeatSpectInput, options?: { readonly signal?: AbortSignal }): AsyncResult<BeatModelOutput>;
  release?(): Promise<void>;
}

/** Beat-model session opened through media's `createOnnxRuntime`. */
export interface BeatOnnxRuntime {
  openSession(
    modelPath: string,
    options: {
      readonly operation: string;
      readonly candidates: readonly BeatDevice[];
      readonly signal?: AbortSignal;
    },
  ): AsyncResult<BeatOnnxSession>;
  /** Where its sessions and the front end's run; absent: DEFAULT_BEAT_PLAN (WebGPU, then the CPU). */
  plan?(): Promise<BeatDevicePlan>;
}

/** PCM the tracker consumes. A path is 22.05 kHz mono (wav or f32le). */
export type BeatAudio = Float32Array | { readonly path: string };
