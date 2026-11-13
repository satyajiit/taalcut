// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The previews job's file: waveform peaks (the thumbnail is its own job since IX-D4, thumbnail.ts, and the
 * filmstrip since UX2, make-filmstrip.ts). Pass `alreadyNormalised` when `source` is the proxy: its audio is the
 * clip's, read on the proxy's frame grid. Peaks come from the audio pass's PCM of the asset when the port has it.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import type { MediaContext } from '../ffmpeg';
import { settledPlan } from '../normalise/settled';
import type { NormalisationPlan } from '../normalise/types';
import { proxyRate } from '../proxy/ladder';
import type { SpeechPcmPort } from './speech-pcm-port';
import { makeWaveform, type WaveformOptions } from './waveform';

export interface PreviewOutputs {
  readonly waveform: string;
}

export interface PreviewResult {
  /** Absent when the clip has no sound. */
  readonly waveform?: { readonly bytes: number; readonly bucketsPerSec: number; readonly count: number };
}

export interface PreviewOptions {
  readonly out: PreviewOutputs;
  readonly alreadyNormalised?: boolean;
  readonly signal?: AbortSignal;
  /** Waveform peaks from the audio pass, and the asset they belong to (its own file, not the proxy). */
  readonly pcm?: { readonly port: SpeechPcmPort; readonly path: string; readonly contentHash?: string };
}

/** The waveform reads the audio pass's PCM of the asset (its own plan) when the port has it. */
function waveformOptions(plan: NormalisationPlan, options: PreviewOptions): WaveformOptions {
  const { signal, pcm } = options;
  if (!pcm) return signal ? { signal } : {};
  const asset = { path: pcm.path, plan, ...(pcm.contentHash ? { contentHash: pcm.contentHash } : {}) };
  return { ...(signal ? { signal } : {}), pcm: { port: pcm.port, asset } };
}

export async function makePreviews(
  source: string,
  plan: NormalisationPlan,
  ctx: MediaContext,
  options: PreviewOptions,
): AsyncResult<PreviewResult> {
  const working = options.alreadyNormalised ? settledPlan(plan, proxyRate(plan)) : plan;
  const waveform = await makeWaveform(
    source,
    working,
    ctx,
    options.out.waveform,
    waveformOptions(plan, options),
  );
  if (!waveform.ok) return waveform;
  return ok(waveform.value.bytes > 0 ? { waveform: waveform.value } : {});
}
