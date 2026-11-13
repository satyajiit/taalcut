// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's SoundListener (EAR1-F7, for lane A2's render QA): what a render sounds like, as `RenderListening`. Two
 * implementations of one request: `createSoundListener` analyses in this process (the jobs process, tests), and
 * `createJobSoundListener` sends the same request as an `audio.listen.analyse` job through a JobRunner, so the
 * render process never opens an ONNX session. Both hear measures, events, the cut sync, the audit, realness and
 * the critique (when lane A1's critic is plugged in: analysis/extensions.ts), never download a model unless asked,
 * and leave realness, critique and `model` null when no model can run: the signal-processing checks need none.
 */
import {
  err,
  ok,
  type AsyncResult,
  type CutSyncReport,
  type HearRenderInput,
  type JobId,
  type JobPriority,
  type JobRunner,
  type RenderListening,
  type Result,
  type SoundListener,
} from '@taalcut/core';
import { analyseSound, type ListenAnalysisDeps } from './analysis/analyse';
import type { ListenOptions, ListenWant, SoundAnalysis } from './analysis/schema';
import { ListenFailed } from './errors';
import { audioListenAnalyseJob } from './jobs';

/** What a render's listening runs (the critique comes with `critique`, cut sync with the cuts). */
export const RENDER_LISTEN_WANT: ListenWant = { measures: true, events: true, audit: true, realness: true };

export interface HearOptions {
  /** Download a model that isn't installed (default false: QA never starts a download). */
  readonly install?: boolean;
}

/**
 * The port's input, plus the running job it is part of: render's QA runs inside the export job, which holds the
 * 'gpu' slot, so the analysis must run as its child (JobRunOptions.parentJobId) or it would wait for itself.
 * Core's HearRenderInput doesn't carry it yet (an EAR1 core request); a caller passes it here meanwhile.
 */
export type JobHearRenderInput = HearRenderInput & { readonly parentJobId?: JobId };

export interface JobSoundListener extends SoundListener {
  hearRender(input: JobHearRenderInput): AsyncResult<RenderListening>;
}

/** The analysis options a render's listening asks for. */
export function renderListenOptions(input: HearRenderInput, options: HearOptions = {}): ListenOptions {
  return {
    cuts: [...input.cuts],
    ...(input.beats ? { beats: [...input.beats] } : {}),
    ...(input.frameRate ? { frameRate: input.frameRate } : {}),
    want: RENDER_LISTEN_WANT,
    critique: { profile: input.profile, ...(input.reference ? { reference: input.reference } : {}) },
    install: options.install ?? false,
    optionalModels: true,
  };
}

const NO_CUTS: CutSyncReport = {
  items: [],
  cutsWithoutHit: [],
  okShare: 0,
  nearShare: 0,
  chanceShare: 0,
  medianOffsetMs: null,
  toleranceMs: 40,
};

/** The analysis as core's RenderListening (it asked for measures and the audit, so both are there). */
export function toRenderListening(analysis: SoundAnalysis): Result<RenderListening> {
  if (!analysis.measures || !analysis.audit)
    return err(ListenFailed(undefined, { detail: 'the analysis has no measures or audit' }));
  return ok({
    measures: analysis.measures,
    events: analysis.events,
    cutSync: analysis.cutSync ?? NO_CUTS,
    audit: analysis.audit,
    critique: analysis.critique,
    realness: analysis.realness,
    model: analysis.model,
  });
}

/** In this process: the analysis runs here (its deps' sessions and spectrogram runner). */
export function createSoundListener(deps: ListenAnalysisDeps, options: HearOptions = {}): SoundListener {
  return {
    async hearRender(input) {
      const analysed = await analyseSound(deps, {
        path: input.file,
        ...renderListenOptions(input, options),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      return analysed.ok ? toRenderListening(analysed.value) : analysed;
    },
  };
}

export interface JobSoundListenerOptions extends HearOptions {
  /** Default: the kind's (low); a child of a running export starts at once whatever its priority. */
  readonly priority?: JobPriority;
}

/** Through the jobs queue (`audio.listen.analyse` in the jobs process): what render's root registers. */
export function createJobSoundListener(
  runner: Pick<JobRunner, 'run'>,
  options: JobSoundListenerOptions = {},
): JobSoundListener {
  return {
    async hearRender(input) {
      const ran = await runner.run(
        audioListenAnalyseJob,
        { path: input.file, ...renderListenOptions(input, options) },
        {
          ...(input.signal ? { signal: input.signal } : {}),
          ...(input.parentJobId ? { parentJobId: input.parentJobId } : {}),
          ...(options.priority ? { priority: options.priority } : {}),
        },
      );
      return ran.ok ? toRenderListening(ran.value) : ran;
    },
  };
}
