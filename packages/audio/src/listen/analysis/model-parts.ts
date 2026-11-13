// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An analysis's model parts (EAR1-F7): tags, sections and realness. A model that can't run here is skipped when the
 * request allows it (`optionalModels`), and so (EAR1-R1) is a model that fails while running (a GPU or runtime
 * error): render QA asks this way, and its signal-processing checks (cut sync, the audit) must still answer when a
 * model doesn't. Such a skip is logged once per analysis and makes it transient: not cached, so the next one tries
 * again. Cancellation is never skipped.
 */
import { err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { describeSound, type SoundDescription } from '../describe/describe';
import type { SpectrogramRunner } from '../dsp/spectrogram-graph';
import { timelineMono } from '../models/pcm';
import { listenSections, toSoundSection } from '../timeline/sections';
import type { RealnessScorer } from './hooks';
import { skippable, type ModelPlan } from './plan';
import type { ListenOptions, SoundAnalysis, SoundTagsResult } from './schema';
import type { DecodedListen } from './source';

export interface ModelParts {
  readonly tags: SoundTagsResult | null;
  readonly sections: SoundAnalysis['sections'];
  readonly realness: SoundAnalysis['realness'];
  /** Some model part ran (the analysis names its models). */
  readonly ran: boolean;
  /** A part was left out because a model failed: the analysis isn't cached. */
  readonly transient: boolean;
}

const NOTHING_HEARD: ModelParts = { tags: null, sections: [], realness: null, ran: false, transient: false };

/** A model failure the request lets the analysis go on without (never cancellation or a bad request). */
export const optionalFailure = (options: ListenOptions, error: TaalcutError): boolean =>
  error.code !== 'core.cancelled' &&
  error.code !== 'audio.listen_bad_input' &&
  (skippable(options, error) || options.optionalModels === true);

function tagsOf(described: SoundDescription): SoundTagsResult {
  return {
    tags: described.tags.slice(0, 50),
    hints: described.hints.slice(0, 50),
    audioSet: described.audioSet.slice(0, 5),
    musicP: described.musicP === null ? null : Math.min(1, Math.max(0, described.musicP)),
    nearSilent: described.nearSilent,
    tooShort: described.tooShort,
    character: described.character.slice(0, 5),
  };
}

export interface ModelPartsDeps {
  readonly realness?: RealnessScorer;
  readonly log: (line: string) => void;
}

/** Tags, sections and realness, in that order; the first model failure the request allows ends the model parts. */
export async function modelParts(
  deps: ModelPartsDeps,
  decoded: DecodedListen,
  options: ListenOptions,
  plan: ModelPlan,
  spectrograms: SpectrogramRunner,
  signal?: AbortSignal,
): AsyncResult<ModelParts> {
  const models = plan.set?.models;
  const { want } = options;
  if (!models) return ok(NOTHING_HEARD);
  const opts = signal ? { signal } : {};
  let tags: SoundTagsResult | null = null;
  let sections: SoundAnalysis['sections'] = [];
  let realness: SoundAnalysis['realness'] = null;
  let ran = false;
  const failed = (part: string, error: TaalcutError): AsyncResult<ModelParts> => {
    if (!optionalFailure(options, error)) return Promise.resolve(err(error));
    deps.log(`[listen] ${part} left out (${error.code}): ${(error.detail ?? '').slice(0, 200)}`);
    return Promise.resolve(ok({ tags, sections, realness, ran, transient: true }));
  };
  if (want.tags) {
    const described = await describeSound(models, decoded.source, opts);
    if (!described.ok) return failed('tags', described.error);
    tags = tagsOf(described.value);
    ran = true;
  }
  if (want.sections) {
    const pcm = { samples: decoded.source.samples, channels: decoded.source.channels ?? 1 };
    const found = await listenSections(models, timelineMono(pcm), opts);
    if (!found.ok) return failed('sections', found.error);
    sections = found.value.sections.map(toSoundSection);
    ran = true;
  }
  if (want.realness && deps.realness) {
    const scored = await deps.realness({ ...decoded, spectrograms, models, ...opts });
    if (!scored.ok) return failed('realness', scored.error);
    realness = scored.value;
    ran = true;
  }
  return ok({ tags, sections, realness, ran, transient: false });
}
