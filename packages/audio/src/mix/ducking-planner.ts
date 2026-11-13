// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's DuckingPlanner (SPEC P3.5), registered in the render process: render writes the stems, asks for the
 * envelopes, applies them, and runs `check` on what it mixed for QA's voiceOverMusic. `plan` meters the dry voice
 * and the un-ducked music (or, without music, the effects), plans the envelope, and dry-runs it: the envelope is
 * applied in process and the 3 s check run; windows that fail are lowered by their shortfall plus 1 LU and the
 * envelope planned once more. Effects take the same envelope as the music.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
  type DuckingPlanner,
  type DuckingSettings,
  type DuckingStems,
  type GainPoint,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { decodeAudioFile } from '../pcm/decode';
import { encodeFloatWav } from '../pcm/pcm';
import { applyEnvelope } from './apply-envelope';
import { MIX_CONFIG } from './config';
import { planEnvelope, type Envelope } from './ducking';
import { createLoudnessMeter, type LoudnessMeter, type LoudnessSeries } from './loudness-series';
import { checkMargin } from './margin';
import { voicedWindows, type Window } from './voice-activity';

export interface DuckingPlannerDeps {
  readonly media: MediaContext;
  readonly scratchDir?: string;
  readonly onComputeFallback?: (event: ComputeFallbackEvent) => void;
  /** Tests and other hosts may meter differently. */
  readonly meter?: LoudnessMeter;
}

/** Per window: how far the dry run missed, plus 1 LU. */
function corrections(
  windows: readonly Window[],
  failing: readonly { frame: number; margin: number }[],
  marginLu: number,
) {
  return windows.map((w) => {
    let worst = 0;
    for (const f of failing) {
      const endMs = (f.frame + 1) * MIX_CONFIG.hopMs;
      // The frame's 3 s window overlaps this voiced window.
      if (endMs > w.startMs && endMs - MIX_CONFIG.check.windowMs < w.endMs)
        worst = Math.max(worst, marginLu - f.margin);
    }
    return worst > 0 ? worst + 1 : 0;
  });
}

export function createDuckingPlanner(deps: DuckingPlannerDeps): DuckingPlanner {
  const meter =
    deps.meter ??
    createLoudnessMeter({
      media: deps.media,
      ...(deps.scratchDir ? { scratchDir: deps.scratchDir } : {}),
      ...(deps.onComputeFallback ? { onComputeFallback: deps.onComputeFallback } : {}),
    });

  /** The reference stem with the envelope applied, metered: what the 3 s check reads. */
  async function duckedSeries(
    path: string,
    envelope: Envelope,
    dir: string,
    signal?: AbortSignal,
  ): AsyncResult<LoudnessSeries> {
    const pcm = await decodeAudioFile(path, deps.media, {
      sampleRate: MIX_CONFIG.sampleRate,
      channels: 2,
      ...(signal ? { signal } : {}),
    });
    if (!pcm.ok) return pcm;
    const ducked = join(dir, 'ducked.wav');
    await writeFile(ducked, encodeFloatWav(applyEnvelope(pcm.value, envelope.points)));
    return meter.measure(ducked, signal);
  }

  async function planFor(
    stems: DuckingStems,
    settings: DuckingSettings,
    reference: string,
  ): AsyncResult<readonly GainPoint[]> {
    const signal = stems.signal;
    const voice = await meter.measure(stems.voice, signal);
    if (!voice.ok) return voice;
    const music = await meter.measure(reference, signal);
    if (!music.ok) return music;
    const durationMs = (stems.durationSamples * 1000) / MIX_CONFIG.sampleRate;
    const windows = voicedWindows(voice.value.momentary, durationMs);
    const base = {
      voiceMomentary: voice.value.momentary,
      musicMomentary: music.value.momentary,
      voiceShortTerm: voice.value.shortTerm,
      musicShortTerm: music.value.shortTerm,
      windows,
      settings,
      durationMs,
    };
    const first = planEnvelope(base);
    if (first.points.length === 0) return ok(first.points);
    const dir = await mkdtemp(join(deps.scratchDir ?? tmpdir(), 'taalcut-duck-'));
    try {
      const ducked = await duckedSeries(reference, first, dir, signal);
      if (!ducked.ok) return ducked;
      const { report, failingFrames } = checkMargin({
        voiceShortTerm: voice.value.shortTerm,
        musicShortTerm: ducked.value.shortTerm,
        windows,
        marginLu: settings.marginLu,
      });
      if (report.passed) return ok(first.points);
      const failing = failingFrames.map((frame) => ({
        frame,
        margin: (voice.value.shortTerm[frame] ?? 0) - (ducked.value.shortTerm[frame] ?? 0),
      }));
      return ok(planEnvelope({ ...base, extraDb: corrections(windows, failing, settings.marginLu) }).points);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return {
    async plan(stems, settings) {
      const reference = stems.music ?? stems.effects;
      if (!settings.enabled || !reference) return ok({ music: [], effects: [] });
      const points = await planFor(stems, settings, reference);
      if (!points.ok) return points;
      return ok({ music: stems.music ? points.value : [], effects: stems.effects ? points.value : [] });
    },

    async check(stems, marginLu) {
      const voice = await meter.measure(stems.voice, stems.signal);
      if (!voice.ok) return voice;
      const music = await meter.measure(stems.duckedMusic, stems.signal);
      if (!music.ok) return music;
      const durationMs = voice.value.momentary.length * MIX_CONFIG.hopMs;
      const windows = voicedWindows(voice.value.momentary, durationMs);
      const { report } = checkMargin({
        voiceShortTerm: voice.value.shortTerm,
        musicShortTerm: music.value.shortTerm,
        windows,
        marginLu,
      });
      return ok(report);
    },
  };
}
