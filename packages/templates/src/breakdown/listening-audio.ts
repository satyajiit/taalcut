// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-C1: `BreakdownAudio.listen` over audio's analysis (`analyseSound`, injected by the jobs root): what the
 * breakdown asks it for, and its answer as the template's listening. The model parts (sections) need CLAP and AST;
 * a model that isn't installed, and can't be, fails the listening (`audio.listen_model_missing`), which the stage
 * turns into `listening_unavailable`. Types only from @taalcut/audio: the root passes the function.
 */
import {
  err,
  ok,
  TEMPLATE_LISTENING_VERSION,
  UnknownError,
  type AsyncResult,
  type TemplateListening,
} from '@taalcut/core';
import type { AnalyseSoundRequest, SoundAnalysis } from '@taalcut/audio';
import type { BreakdownAudio } from './ports';

export interface BreakdownListenerOptions {
  /** Download a model that isn't installed (the app); false: it is missing (test builds, which never download). */
  readonly install: boolean;
  /** Ask for the model parts (sections). False: signal processing only, with no model (the evals' stand-ins). */
  readonly models?: boolean;
  /**
   * K1: the reel's own critique metrics (audio's filmMetrics over the same cuts), so a draft can be critiqued against
   * its reel on every row. Null, or absent, leaves them out; the listening stands without them.
   */
  readonly critiqueMetrics?: (
    request: AnalyseSoundRequest,
    analysis: SoundAnalysis,
  ) => Promise<Readonly<Record<string, number | null>> | null>;
}

/** The analysis as the template's listening: its effects on the cuts are the stage's to derive. */
export function templateListeningOf(
  analysis: SoundAnalysis,
  critiqueMetrics?: Readonly<Record<string, number | null>> | null,
): AsyncResult<TemplateListening> {
  if (!analysis.measures || !analysis.cutSync)
    return Promise.resolve(
      err(UnknownError(undefined, { detail: 'the analysis has no measures or cut sync' })),
    );
  return Promise.resolve(
    ok({
      version: TEMPLATE_LISTENING_VERSION,
      model: analysis.model,
      measures: analysis.measures,
      events: analysis.events,
      sections: analysis.sections,
      cutSync: analysis.cutSync,
      sfxAtCuts: [],
      ...(analysis.realness ? { realness: analysis.realness } : {}),
      ...(critiqueMetrics ? { critiqueMetrics: { ...critiqueMetrics } } : {}),
    }),
  );
}

export function breakdownListener(
  analyse: (request: AnalyseSoundRequest) => AsyncResult<SoundAnalysis>,
  options: BreakdownListenerOptions,
): NonNullable<BreakdownAudio['listen']> {
  const models = options.models ?? true;
  return async ({ path, cuts, beats, frameRate, signal }) => {
    const request: AnalyseSoundRequest = {
      path,
      cuts: [...cuts],
      ...(beats && beats.length > 0 ? { beats: [...beats] } : {}),
      ...(frameRate ? { frameRate } : {}),
      want: { measures: true, events: true, key: true, tempo: true, ...(models ? { sections: true } : {}) },
      install: options.install,
      signal,
    };
    const analysed = await analyse(request);
    if (!analysed.ok) return analysed;
    // The metrics are extra: a failure to measure them never loses the listening.
    const metrics = options.critiqueMetrics
      ? await options.critiqueMetrics(request, analysed.value).catch(() => null)
      : null;
    return templateListeningOf(analysed.value, metrics);
  };
}
