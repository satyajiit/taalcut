// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * WebGPU against the CPU for Beat This! (P3-B1). onnxruntime-node 1.30's WebGPU execution provider got Silero
 * VAD's LSTM state wrong (cleanup SPEC), so every other model Taalcut runs on WebGPU is checked the same way:
 * the same inputs through a WebGPU-only session and a CPU-only session, compared at the output and at the task.
 *
 * - The log-mel front end (`audio.beatFrontEnd`, a generated graph on WebGPU) against the f64 oracle.
 * - The beat model (`audio.trackBeats`): identical spectrogram windows in, logits compared, then the beats the
 *   tracker places from each, which must agree within one frame (20 ms at 50 fps).
 *
 * Opt-in: runs when the model is in `packages/audio/.cache/beat-this/` (or `TAALCUT_BEAT_THIS_DIR`), skipped with
 * the reason otherwise. A Mac whose WebGPU session can't be created has nothing to compare and says so.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, type ComputeFallbackEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { referenceLogMel } from '../../src/beats/frontend';
import { runLogMel } from '../../src/beats/mel-onnx';
import { createOrtBeatRuntime } from '../../src/beats/ort';
import { createBeatTracker } from '../../src/beats/tracker';
import type { BeatModelOutput, BeatOnnxRuntime } from '../../src/beats/types';
import { beatClicks, groove } from '../helpers/beat-signals';
import { difference, worstMatch } from '../helpers/parity';

const modelDir =
  process.env.TAALCUT_BEAT_THIS_DIR ?? fileURLToPath(new URL('../../.cache/beat-this/', import.meta.url));
const HAS_MODEL =
  existsSync(join(modelDir, 'beat_this.onnx')) && existsSync(join(modelDir, 'mel-filterbank.bin'));

/** Log-mel is log1p(1000 · mel), about 0–12 here; float32 kernels against f64 stay well inside this. */
const LOG_MEL_MAX_ABS = 1e-3;
/** Logits (pre-sigmoid). The task check below is what matters; this catches a broken kernel. */
const LOGIT_MAX_ABS = 0.05;
/** One frame at 50 fps. */
const BEAT_MS = 20;

const SIGNALS = [
  { name: 'clicks 120 BPM, 45 s', samples: () => beatClicks(120, 45) },
  { name: 'groove 96 BPM, 45 s', samples: () => groove(96, 45, 7) },
  { name: 'groove 141 BPM, 20 s', samples: () => groove(141, 20, 11) },
] as const;

interface Recording {
  backend: string;
  readonly inputs: Float32Array[];
  readonly outputs: BeatModelOutput[];
}

/** Opens only `backend` and keeps a copy of every window in and out. */
function recordingRuntime(backend: 'webgpu' | 'cpu', recording: Recording): BeatOnnxRuntime {
  const inner = createOrtBeatRuntime();
  return {
    async openSession(path, options) {
      const opened = await inner.openSession(path, { ...options, candidates: [backend] });
      if (!opened.ok) return opened;
      const session = opened.value;
      recording.backend = session.backend;
      return ok({
        backend: session.backend,
        release: async () => session.release?.(),
        async run(input, runOptions) {
          recording.inputs.push(Float32Array.from(input.data));
          const result = await session.run(input, runOptions);
          if (result.ok) {
            recording.outputs.push({
              beat: Float32Array.from(result.value.beat),
              downbeat: Float32Array.from(result.value.downbeat),
            });
          }
          return result;
        },
      });
    },
  };
}

async function filterbank(): Promise<Float32Array> {
  const bytes = await readFile(join(modelDir, 'mel-filterbank.bin'));
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/** Every window's values end to end. */
const joined = (parts: readonly Float32Array[]): Float32Array =>
  Float32Array.from(parts.flatMap((part) => [...part]));

describe.skipIf(!HAS_MODEL)(
  `Beat This! on WebGPU against the CPU${HAS_MODEL ? '' : ` (skipped: no beat_this.onnx in ${modelDir})`}`,
  () => {
    it('the WebGPU log-mel front end matches the f64 oracle', async (context) => {
      const bank = await filterbank();
      for (const signal of SIGNALS) {
        const samples = signal.samples();
        const fallbacks: ComputeFallbackEvent[] = [];
        const gpu = await runLogMel(samples, bank, (event) => fallbacks.push(event));
        if (fallbacks.length > 0) {
          context.skip(`no WebGPU log-mel on this Mac: ${JSON.stringify(fallbacks)}`);
          return;
        }
        const diff = difference(gpu.logMel, referenceLogMel(samples, bank));
        console.warn(
          `beat front end, ${signal.name}: max |Δ| ${diff.maxAbs.toExponential(2)}, mean ${diff.meanAbs.toExponential(2)}`,
        );
        expect(diff.maxAbs).toBeLessThanOrEqual(LOG_MEL_MAX_ABS);
      }
    }, 120_000);

    it('the beat model gives the same logits and beats on WebGPU and the CPU', async (context) => {
      for (const signal of SIGNALS) {
        const samples = signal.samples();
        const gpu: Recording = { backend: '', inputs: [], outputs: [] };
        const cpu: Recording = { backend: '', inputs: [], outputs: [] };
        const onWebGpu = await createBeatTracker({
          modelDir,
          onnx: recordingRuntime('webgpu', gpu),
        }).trackBeats(samples);
        if (!onWebGpu.ok) {
          context.skip(
            `no WebGPU session for Beat This! on this Mac: ${onWebGpu.error.detail ?? onWebGpu.error.code}`,
          );
          return;
        }
        const onCpu = await createBeatTracker({ modelDir, onnx: recordingRuntime('cpu', cpu) }).trackBeats(
          samples,
        );
        expect(onCpu.ok).toBe(true);
        if (!onCpu.ok) return;
        expect([gpu.backend, cpu.backend]).toEqual(['webgpu', 'cpu']);
        // Same windows in (the front end is deterministic), so any difference below is the model's.
        expect(difference(joined(gpu.inputs), joined(cpu.inputs)).maxAbs).toBe(0);
        const beat = difference(
          joined(gpu.outputs.map((o) => o.beat)),
          joined(cpu.outputs.map((o) => o.beat)),
        );
        const down = difference(
          joined(gpu.outputs.map((o) => o.downbeat)),
          joined(cpu.outputs.map((o) => o.downbeat)),
        );
        const gpuBeats = onWebGpu.value.beatMap.beats.map((b) => b.value);
        const cpuBeats = onCpu.value.beatMap.beats.map((b) => b.value);
        const worst = worstMatch(gpuBeats, cpuBeats);
        console.warn(
          `beat model, ${signal.name}: ${gpu.outputs.length} windows, beat logits max |Δ| ` +
            `${beat.maxAbs.toExponential(2)} (mean ${beat.meanAbs.toExponential(2)}), downbeat max |Δ| ` +
            `${down.maxAbs.toExponential(2)}; beats ${gpuBeats.length} vs ${cpuBeats.length}, worst ${worst} ms, ` +
            `bpm ${onWebGpu.value.beatMap.bpm} vs ${onCpu.value.beatMap.bpm}`,
        );
        expect(beat.maxAbs).toBeLessThanOrEqual(LOGIT_MAX_ABS);
        expect(down.maxAbs).toBeLessThanOrEqual(LOGIT_MAX_ABS);
        expect(worst).toBeLessThanOrEqual(BEAT_MS);
        expect(onWebGpu.value.beatMap.bpm).toBe(onCpu.value.beatMap.bpm);
      }
    }, 300_000);
  },
);
