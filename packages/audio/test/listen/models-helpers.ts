// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shared by the EAR1-F4/F5 tests: the parity clips as the models hear them, the unpacked model builds
 * (`TAALCUT_EAR1_MODELS`, see tools/components/listen/README.md), and a front-end graph run on one named
 * execution provider, outside the sessions' device plan.
 */
import { encodeOnnxModel } from '@taalcut/media';
import { ffmpegMono, loadClip, mono } from '../../../../tools/earshot-parity/fixtures.mjs';
import {
  frameBatch,
  frontEndConstants,
  splitFeatures,
  type FrontEndSpec,
} from '../../src/listen/models/frontend-graph';
import { loadListenOrt } from '../../src/listen/models/ort';

/** The folder of unpacked builds; tests that need the real models are skipped without it. */
export const MODELS = process.env.TAALCUT_EAR1_MODELS?.replace(/^~(?=\/)/, process.env.HOME ?? '~');

/** `audio.load(mono=True)`: what CLAP and AST read. */
export const modelMono = (id: string): Float32Array => ffmpegMono(loadClip(id));
/** `audio.to_mono(audio.load())`: what timeline.py's sections read. */
export const timelineMonoOf = (id: string): Float32Array => mono(loadClip(id));

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / Math.sqrt(na * nb);
}

/** The graph on `provider` alone; undefined when that provider can't open it here. */
export async function runGraphOn(
  spec: FrontEndSpec,
  segments: readonly Float32Array[],
  provider: 'cpu' | 'webgpu',
): Promise<Float32Array[] | undefined> {
  const ort = await loadListenOrt();
  const framed = frameBatch(spec, segments);
  let session;
  try {
    session = await ort.InferenceSession.create(encodeOnnxModel(spec.graph(framed.rows)), {
      executionProviders: [provider],
      logSeverityLevel: 3,
    });
  } catch {
    return undefined;
  }
  const feeds: Record<string, unknown> = {
    frames: new ort.Tensor('float32', framed.frames, [framed.rows, spec.frameLength]),
  };
  for (const [name, constant] of Object.entries(frontEndConstants(spec))) {
    feeds[name] = new ort.Tensor('float32', constant.data, constant.dims);
  }
  const outputs = await session.run(feeds);
  await session.release?.();
  const out = Object.values(outputs)[0] as { data: Float32Array };
  return splitFeatures(spec, out.data, framed.valid);
}

/** Largest |a − b| over the entries where `reference` is within `range` of its maximum (all of them by default). */
export function maxAbsNearPeak(
  a: ArrayLike<number>,
  reference: ArrayLike<number>,
  range = Number.POSITIVE_INFINITY,
): number {
  let peak = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < reference.length; i++) peak = Math.max(peak, reference[i] ?? 0);
  let worst = 0;
  for (let i = 0; i < reference.length; i++) {
    const r = reference[i] ?? 0;
    if (r >= peak - range) worst = Math.max(worst, Math.abs((a[i] ?? 0) - r));
  }
  return worst;
}
