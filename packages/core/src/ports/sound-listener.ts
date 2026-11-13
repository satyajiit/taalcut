// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The sound listener (EAR1-A2): what render's QA hears in a render or a draft, for `soundOnCuts`, `soundClean` and
 * `soundCritique`. Render can't import @taalcut/audio, so it reaches listening through this port, as it reaches the
 * ducking planner (ducking.ts): render's root registers the listener (apps/desktop roots/render-listener.ts), which
 * runs the model work as a job in the audio process, so the render process never opens an ONNX session.
 */
import type { JobId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { RenderListening, SoundCritiqueProfile } from '../audio/listening-report';
import type { FrameRate } from '../time/frame-rate';
import type { RationalTime } from '../time/rational-time';
import type { TemplateListening } from '../templates/template-audio';

export interface HearRenderInput {
  /** The rendered or draft media: an absolute path inside render's work folder. */
  readonly file: string;
  /** The timeline's cuts, in order: the cut sync report's `cutIndex` indexes this. */
  readonly cuts: readonly RationalTime[];
  /** The music's beats, when the timeline has a beat map: each cut's and event's beat offset. */
  readonly beats?: readonly RationalTime[];
  /** The picture's frame rate: an `ok` sync is within one frame of it (40 ms without one). */
  readonly frameRate?: FrameRate;
  /** `reference` critiques against `reference`, the template reel's own sound; `launch` against launch films. */
  readonly profile: SoundCritiqueProfile;
  readonly reference?: TemplateListening;
  /**
   * The running job this listening is part of (render QA runs inside the export, which holds the 'gpu' slot): the
   * listen job runs in that job's slot instead of waiting behind it.
   */
  readonly parentJobId?: JobId;
  readonly signal?: AbortSignal;
}

export interface SoundListener {
  /**
   * Measures, events, cut sync, the audit, the critique and realness of a render. Fails with the audio package's
   * `audio.listen_*` errors (bad input, unavailable, failed). A missing model may leave `critique`, `realness` and
   * `model` null instead of failing: the signal-processing checks (`soundOnCuts`, `soundClean`) need none.
   */
  hearRender(input: HearRenderInput): AsyncResult<RenderListening>;
}
export const SoundListenerToken = createToken<SoundListener>('core.soundListener');
