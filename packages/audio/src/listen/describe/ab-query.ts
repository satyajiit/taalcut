// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `audio.listen.query` op `ab` (EAR1-A3, `audio.compare`): earshot's `ab` in the jobs process. Sources: A, B, then
 * any references. CLAP's cosine and likeness, which of the two is closer to a description (calibrated z) or to the
 * references (typicality), and how B differs from A in measured terms (compare-features.ts on F6's measure, in
 * upstream's words and order). The sources are the models' decode (48 kHz mono at ffmpeg `-ac 1`'s level): for a
 * mono file that is upstream's measure input exactly; a stereo file is measured as its mono fold (width reads mono).
 * Registered in LISTEN_EXTENSIONS; it imports nothing from there (no cycle), so its context type is written here.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { z } from 'zod';
import { measureSound } from '../dsp/measure';
import type { SpectrogramRunner } from '../dsp/spectrogram-graph';
import { ListenBadInput, ListenUnavailable } from '../errors';
import { abSounds, type AbComparison, type CompareFeatures } from './compare';
import { compareFeatures } from './compare-features';
import { sourceAt, sourcesFrom, type ListenModels, type ListenSource, type ListenSources } from './context';

export interface AbQueryContext {
  readonly models: ListenModels;
  readonly sources: ListenSources;
  readonly spectrograms?: () => Promise<SpectrogramRunner>;
  readonly signal?: AbortSignal;
}

export const abQueryParamsSchema = z.object({
  query: z.string().trim().min(1).max(300).optional(),
  k: z.int().min(1).max(20).optional(),
});
export type AbQueryParams = z.output<typeof abQueryParamsSchema>;

/** The comparison with both sounds' comparable measurements. */
export type AbQueryResult = AbComparison & { readonly features: readonly [CompareFeatures, CompareFeatures] };

async function featuresOf(source: ListenSource, runner: SpectrogramRunner): Promise<CompareFeatures> {
  const audio = { sampleRate: 48_000, channels: [source.samples] };
  return compareFeatures(await measureSound(audio, runner), audio);
}

export const abQuery = {
  op: 'ab',
  params: abQueryParamsSchema,
  sources: { min: 2, max: 22 },
  async run(context: AbQueryContext, params: AbQueryParams): AsyncResult<AbQueryResult> {
    const { sources, signal } = context;
    if (sources.length < 2) return err(ListenBadInput(undefined, { detail: 'ab compares two sounds' }));
    if (!context.spectrograms) return err(ListenUnavailable({ reason: 'no_spectrograms' }));
    const a = await sourceAt(sources, 0, signal);
    if (!a.ok) return a;
    const b = await sourceAt(sources, 1, signal);
    if (!b.ok) return b;
    const refs = sourcesFrom(sources, 2);
    const runner = await context.spectrograms();
    const features = [await featuresOf(a.value, runner), await featuresOf(b.value, runner)] as const;
    const compared = await abSounds(context.models, a.value, b.value, {
      ...(params.query ? { query: params.query } : {}),
      ...(refs.length >= 2 ? { refs } : {}),
      ...(params.k !== undefined ? { k: params.k } : {}),
      features,
      ...(signal ? { signal } : {}),
    });
    return compared.ok ? ok({ ...compared.value, features }) : compared;
  },
};
