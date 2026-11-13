// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Crossfades at speech cuts (P3-V9, SPEC P3.9; audio SPEC P3.7). Talking-head cleanup cuts one take into
 * pieces whose source ranges no longer touch; the picture cuts on the frame, but the sound would jump from
 * one waveform to another mid-cycle and click. Each such join gets a 12 ms equal-power crossfade centred on
 * the cut: the outgoing piece plays 6 ms of source past its out-point fading out, the incoming one starts
 * 6 ms early fading in (`qsin` curves: sin² + cos² = 1, the `acrossfade=c1=qsin:c2=qsin` shape). Both
 * segments keep their place, so the mix's sample count is unchanged. Pure.
 */
import type { PlannedAudioClip, RenderPlan } from '../plan/types';
import { samplesForFrames } from '../time/frames';
import { MIX_SAMPLE_RATE, toSamples, type MixSegment } from './mix-types';

/** The crossfade's whole length; the research allows 8–20 ms. */
export const SPEECH_JOIN_MS = 12;

export interface SpeechJoin {
  /** The outgoing and incoming clip ids. */
  readonly from: string;
  readonly to: string;
  /** The cut, in render frames. */
  readonly cutFrame: number;
}

const half = () => Math.round((SPEECH_JOIN_MS / 2 / 1000) * MIX_SAMPLE_RATE);

/** Whether `b` continues `a`'s source exactly (within a sample): then there is nothing to hide. */
function contiguous(a: PlannedAudioClip, b: PlannedAudioClip, plan: RenderPlan): boolean {
  const length =
    samplesForFrames(a.span.end, plan.rate, MIX_SAMPLE_RATE) -
    samplesForFrames(a.span.start, plan.rate, MIX_SAMPLE_RATE);
  return Math.abs(toSamples(a.sourceIn) + length - toSamples(b.sourceIn)) <= 1;
}

/**
 * Hard cuts between two real-time pieces of the same asset on the same track whose source ranges don't touch.
 * A transition already crossfades its clips, and a speed ramp's sound has its own curve, so neither joins.
 */
export function speechJoins(plan: RenderPlan): SpeechJoin[] {
  const joins: SpeechJoin[] = [];
  const byTrack = new Map<string, PlannedAudioClip[]>();
  for (const clip of plan.audio) byTrack.set(clip.track, [...(byTrack.get(clip.track) ?? []), clip]);
  for (const clips of byTrack.values()) {
    const sorted = [...clips].sort((a, b) => a.span.start - b.span.start);
    for (let index = 1; index < sorted.length; index++) {
      const a = sorted[index - 1];
      const b = sorted[index];
      if (!a || !b) continue;
      const hardCut = a.span.end === b.span.start && a.fadeOutFrames === 0 && b.fadeInFrames === 0;
      const realTime = a.speed === null && b.speed === null;
      if (hardCut && realTime && a.assetId === b.assetId && !contiguous(a, b, plan))
        joins.push({ from: a.id, to: b.id, cutFrame: b.span.start });
    }
  }
  return joins;
}

/** The clip segments with each join's crossfade: the outgoing piece runs on, the incoming one starts early. */
export function withSpeechJoins(segments: readonly MixSegment[], joins: readonly SpeechJoin[]): MixSegment[] {
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  for (const join of joins) {
    const outgoing = byId.get(join.from);
    const incoming = byId.get(join.to);
    if (!outgoing || !incoming || outgoing.pieces || incoming.pieces) continue;
    // Less overlap when the incoming piece starts at its file's first sample (no source before it).
    const overlap = Math.min(
      half(),
      incoming.inSample,
      Math.floor(outgoing.samples / 2),
      Math.floor(incoming.samples / 2),
    );
    if (overlap <= 0) continue;
    byId.set(outgoing.id, {
      ...outgoing,
      samples: outgoing.samples + overlap,
      fadeOutSamples: 2 * overlap,
    });
    byId.set(incoming.id, {
      ...incoming,
      inSample: incoming.inSample - overlap,
      startSample: incoming.startSample - overlap,
      samples: incoming.samples + overlap,
      fadeInSamples: 2 * overlap,
    });
  }
  return segments.map((segment) => byId.get(segment.id) ?? segment);
}
