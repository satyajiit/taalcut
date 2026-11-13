// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Silero VAD v6.2.3 (MIT, `silero_vad.onnx`, the `silero-vad` component) over 16 kHz mono: one speech probability
 * per 32 ms window, the 64-sample context prepended as the v6 graph expects, its LSTM state carried. On media's
 * ONNX runtime, on the CPU execution provider (Silero's documented one, under 1 ms a window), logged once as a
 * compute fallback (`audio.vad`, `unsupported_input`): onnxruntime-node's WebGPU provider opens the model but gets
 * its recurrent state wrong, scoring most of a clearly spoken phrase as silence (SPEC P3.0).
 *
 * `probabilities` scores a buffer at once (speech cleanup). `stream` scores audio pushed in pieces, the state and
 * context carried across pushes, so indexing can read an hour of PCM a second at a time (IX-A2); a stream fed the
 * same samples in pieces gives the same probabilities as one buffer.
 */
import { CancelledError, err, ok, type AsyncResult, type ComputeFallbackEvent } from '@taalcut/core';
import { createOnnxRuntime, type OnnxSession } from '@taalcut/media';
import { loadOnnxRuntime } from '../beats/ort-load';
import { CLEANUP_AUDIO_CONFIG } from './config';
import { VadFailed } from './errors';

export const VAD_OPERATION = 'audio.vad';
/** Why the VAD doesn't run on WebGPU (measured 2026-10-14 on a `say` talking head, onnxruntime-node 1.30). */
const WEBGPU_WRONG =
  "the WebGPU provider gets Silero's LSTM state wrong (whole phrases scored as silence); the CPU provider is Silero's own";
const { window: WINDOW, context: CONTEXT, sampleRate: RATE } = CLEANUP_AUDIO_CONFIG.vad;
export const VAD_WINDOW_MS = (WINDOW * 1000) / RATE;

/** Speech probabilities, window i covering samples [i × 512, (i + 1) × 512). */
export interface VoiceActivity {
  readonly probabilities: Float32Array;
  readonly windowMs: number;
  readonly backend: string;
}

/** One pass over consecutive audio. */
export interface VadStream {
  /** The probabilities of the whole windows now complete; a partial window waits for the next push. */
  push(samples: Float32Array, signal?: AbortSignal): AsyncResult<Float32Array>;
}

export interface VadEngine {
  probabilities(samples: Float32Array, signal?: AbortSignal): AsyncResult<VoiceActivity>;
  /** A fresh stream (state and context zeroed), on the engine's one session. */
  stream(): VadStream;
}

function tensorData(value: unknown): ArrayLike<number> | null {
  if (typeof value !== 'object' || value === null || !('data' in value)) return null;
  const data = value.data;
  return data instanceof Float32Array ? data : null;
}

function failure(cause: unknown) {
  return err(
    VadFailed(undefined, { detail: cause instanceof Error ? cause.message.slice(0, 300) : 'VAD failed' }),
  );
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length === 0) return b;
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** The windows, state and context of one stream, on an open session. */
function streamOn(session: () => AsyncResult<OnnxSession>): VadStream {
  let state = new Float32Array(2 * 128);
  /** The last 64 samples of the previous window (zeros before the first). */
  const context = new Float32Array(CONTEXT);
  let pending = new Float32Array(0);
  return {
    async push(samples, signal) {
      if (signal?.aborted) return err(CancelledError());
      const opened = await session();
      if (!opened.ok) return opened;
      try {
        const ort = await import('onnxruntime-node');
        const all = concat(pending, samples);
        const windows = Math.floor(all.length / WINDOW);
        const out = new Float32Array(windows);
        const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(RATE)]), []);
        const [probName, stateName] = opened.value.outputNames;
        const input = new Float32Array(CONTEXT + WINDOW);
        for (let i = 0; i < windows; i++) {
          if (signal?.aborted) return err(CancelledError());
          input.set(context, 0);
          input.set(all.subarray(i * WINDOW, (i + 1) * WINDOW), CONTEXT);
          const outputs = await opened.value.run({
            input: new ort.Tensor('float32', input.slice(), [1, CONTEXT + WINDOW]),
            state: new ort.Tensor('float32', state, [2, 1, 128]),
            sr,
          });
          const prob = tensorData(outputs[probName ?? 'output']);
          const next = tensorData(outputs[stateName ?? 'stateN']);
          if (!prob || !next)
            return err(VadFailed(undefined, { detail: 'the VAD returned no probability or state' }));
          out[i] = prob[0] ?? 0;
          state = Float32Array.from(next);
          context.set(all.subarray((i + 1) * WINDOW - CONTEXT, (i + 1) * WINDOW));
        }
        pending = all.slice(windows * WINDOW);
        return ok(out);
      } catch (cause) {
        return failure(cause);
      }
    },
  };
}

export function createSileroVad(deps: {
  readonly modelPath: string;
  readonly onComputeFallback?: (event: ComputeFallbackEvent) => void;
}): VadEngine {
  const runtime = createOnnxRuntime({
    loadModule: loadOnnxRuntime,
    ...(deps.onComputeFallback ? { onComputeFallback: deps.onComputeFallback } : {}),
  });
  let opened: OnnxSession | undefined;
  const session = async (): AsyncResult<OnnxSession> => {
    if (opened) return ok(opened);
    const created = await runtime.openSession(deps.modelPath, {
      operation: VAD_OPERATION,
      candidates: ['cpu'],
      cpuReason: { reason: 'unsupported_input', detail: WEBGPU_WRONG },
    });
    if (!created.ok)
      return err(
        VadFailed(undefined, { detail: (created.error.detail ?? created.error.code).slice(0, 300) }),
      );
    opened = created.value;
    return ok(created.value);
  };
  return {
    async probabilities(samples, signal) {
      const scored = await streamOn(session).push(samples, signal);
      if (!scored.ok) return scored;
      return ok({ probabilities: scored.value, windowMs: VAD_WINDOW_MS, backend: opened?.backend ?? 'cpu' });
    },
    stream: () => streamOn(session),
  };
}
