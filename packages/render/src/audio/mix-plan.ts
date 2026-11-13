// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * planAudioMix: the render's sound as sample-exact segments at 48 kHz (SPEC
 * section 8). Pure. Every position is a whole sample computed from frames
 * with BigInt (samplesForFrames), so adjacent clips tile without a gap or an
 * overlap and the whole mix is exactly round(N · 48000 · den / num) samples.
 *
 * The music choice decides what joins the clip sound:
 * - a, platformSound: nothing. Reference audio never enters the file, even if
 *   a source for it was handed in.
 * - b, ownTrack: the user's track from `offset` (the track time under frame 0).
 * - c, generated: the warped track audio made for this timeline's beat map,
 *   from frame 0 (P3-V6).
 * - d, referenceAudio: the audio stream of the reel the template keeps, from
 *   its first sample at frame 0, where its beat map starts (REF1). Finding the
 *   file is musicPreflight's job; this only lays it out.
 *
 * With a Style's bumpers (P3-V10) "frame 0" is the timeline's first frame: the
 * music starts after the intro and stops where the outro starts, and the
 * bumpers keep their own clip sound. A cut between two pieces of one take
 * gets a short equal-power crossfade (speech-joins.ts, P3-V9).
 */
import { err, ok, type RationalTime, type Result } from '@taalcut/core';
import { MediaMissing } from '../errors';
import { speedCurve, tempoPieces } from '../plan/speed-curve';
import type { PlannedAudioClip, RenderPlan } from '../plan/types';
import { samplesForFrames } from '../time/frames';
import { MIX_SAMPLE_RATE, toSamples, type AudioMixPlan, type MixSegment } from './mix-types';
import { speechJoins, withSpeechJoins } from './speech-joins';

export { atempoChain } from '../plan/speed-filters';
export { mixFilterGraph, segmentFilter } from './mix-graph';
export { MIX_SAMPLE_RATE, toSamples, type AudioMixPlan, type MixSegment } from './mix-types';

/** Where each planned sound comes from on disk. */
export interface AudioSourceMap {
  /** A clip's audio file and the file time that sounds at the clip's span.start. */
  clip(id: string): { readonly path: string; readonly offset: RationalTime } | undefined;
  /** Path b: the user's track (its offset is on the music choice). */
  readonly ownTrack?: { readonly path: string };
  /** Path d: the kept reel (REF1); its first audio stream is read, from its first sample. */
  readonly reference?: { readonly path: string };
  /** Path c: the generated track, warped onto the beat map (DERIVED_KINDS 'warpedMusic'). */
  readonly generated?: { readonly path: string };
}

/**
 * A ramp keeps its curve when clamped: silence stands in for source before the file's start, and
 * render samples before frame 0 are played and dropped, so every other sample stays where it was.
 */
function clampCurved(segment: MixSegment, total: number): MixSegment | null {
  const padSamples = Math.max(0, -segment.inSample);
  const skipSamples = Math.max(0, -segment.startSample);
  const startSample = segment.startSample + skipSamples;
  const samples = Math.min(segment.samples - skipSamples, total - startSample);
  if (samples <= 0) return null;
  return {
    ...segment,
    inSample: segment.inSample + padSamples,
    startSample,
    samples,
    padSamples,
    skipSamples,
    fadeInSamples: Math.min(segment.fadeInSamples, samples),
    fadeOutSamples: Math.min(segment.fadeOutSamples, samples),
  };
}

/** Keeps a segment inside [0, total): a negative in-point starts it later, a long one is cut. */
function clamp(segment: MixSegment, total: number): MixSegment | null {
  if (segment.pieces) return clampCurved(segment, total);
  let { inSample, startSample, samples } = segment;
  if (inSample < 0) {
    startSample -= inSample;
    samples += inSample;
    inSample = 0;
  }
  if (startSample < 0) {
    inSample += Math.round(-startSample * segment.tempo);
    samples += startSample;
    startSample = 0;
  }
  samples = Math.min(samples, total - startSample);
  if (samples <= 0) return null;
  return {
    ...segment,
    inSample,
    startSample,
    samples,
    fadeInSamples: Math.min(segment.fadeInSamples, samples),
    fadeOutSamples: Math.min(segment.fadeOutSamples, samples),
  };
}

function clipSegment(
  clip: PlannedAudioClip,
  plan: RenderPlan,
  source: { readonly path: string; readonly offset: RationalTime },
): MixSegment {
  const startSample = samplesForFrames(clip.span.start, plan.rate, MIX_SAMPLE_RATE);
  const endSample = samplesForFrames(clip.span.end, plan.rate, MIX_SAMPLE_RATE);
  // A ramp's sound follows the same curve as its picture (the conform's setpts), piece by piece.
  const curve = speedCurve(clip.speed, clip.lead, plan.rate);
  const pieces = curve.ramp
    ? tempoPieces(curve, clip.span.end - clip.span.start, plan.rate, MIX_SAMPLE_RATE)
    : null;
  const samples = endSample - startSample;
  const consumed = pieces?.reduce((sum, piece) => sum + piece.consumed, 0) ?? samples;
  return {
    id: clip.id,
    kind: 'clip',
    path: source.path,
    inSample: toSamples(source.offset),
    startSample,
    samples,
    gainDb: clip.gainDb,
    fadeInSamples: samplesForFrames(clip.fadeInFrames, plan.rate, MIX_SAMPLE_RATE),
    fadeOutSamples: samplesForFrames(clip.fadeOutFrames, plan.rate, MIX_SAMPLE_RATE),
    tempo: samples > 0 ? consumed / samples : 1,
    ...(pieces ? { pieces } : {}),
  };
}

/** Where the music plays on the render: from the timeline's first frame to its last (between the bumpers). */
function musicWindow(plan: RenderPlan, total: number): { readonly start: number; readonly samples: number } {
  const start = plan.bumpers.intro ? samplesForFrames(plan.bumpers.intro.end, plan.rate, MIX_SAMPLE_RATE) : 0;
  const end = plan.bumpers.outro
    ? samplesForFrames(plan.bumpers.outro.start, plan.rate, MIX_SAMPLE_RATE)
    : total;
  return { start, samples: Math.max(0, end - start) };
}

function bed(
  kind: 'music' | 'reference',
  path: string,
  inSample: number,
  gainDb: number,
  window: { readonly start: number; readonly samples: number },
): MixSegment {
  return {
    id: kind,
    kind,
    path,
    inSample,
    startSample: window.start,
    samples: window.samples,
    gainDb,
    fadeInSamples: 0,
    fadeOutSamples: 0,
    tempo: 1,
  };
}

/**
 * EDT1-OPS: the person's music bed on the music's window: it sounds over [start, end) of the timeline (from the
 * timeline's first frame), the sample at timeline t being the one it played at t − shift, with its fades. A muted
 * bed is no segment. A segment that starts before the file is cut by `clamp`.
 */
function onBed(segment: MixSegment, plan: RenderPlan): MixSegment | null {
  const music = plan.musicBed;
  if (!music) return segment;
  if (music.muted) return null;
  const windowEnd = segment.startSample + segment.samples;
  const start = Math.min(segment.startSample + toSamples(music.start), windowEnd);
  const end = music.end ? Math.min(segment.startSample + toSamples(music.end), windowEnd) : windowEnd;
  if (end <= start) return null;
  const length = end - start;
  return {
    ...segment,
    inSample: segment.inSample + toSamples(music.start) - toSamples(music.shift),
    startSample: start,
    samples: length,
    fadeInSamples: Math.min(toSamples(music.fadeIn), length),
    fadeOutSamples: Math.min(toSamples(music.fadeOut), length),
  };
}

function musicSegment(plan: RenderPlan, sources: AudioSourceMap, total: number): Result<MixSegment | null> {
  const laid = baseMusicSegment(plan, sources, total);
  return laid.ok && laid.value ? ok(onBed(laid.value, plan)) : laid;
}

function baseMusicSegment(
  plan: RenderPlan,
  sources: AudioSourceMap,
  total: number,
): Result<MixSegment | null> {
  const music = plan.music;
  const window = musicWindow(plan, total);
  switch (music.path) {
    case 'none':
    case 'platformSound':
      return ok(null);
    case 'ownTrack':
      return sources.ownTrack
        ? ok(bed('music', sources.ownTrack.path, toSamples(music.offset), music.gainDb, window))
        : err(MediaMissing({ name: 'music track' }));
    case 'generated':
      // Warped onto the beat map from the timeline's first frame: no offset to apply.
      return sources.generated
        ? ok(bed('music', sources.generated.path, 0, music.gainDb, window))
        : err(MediaMissing({ name: 'generated music' }));
    case 'referenceAudio':
      return sources.reference
        ? ok(bed('reference', sources.reference.path, 0, music.gainDb, window))
        : err(MediaMissing({ name: 'reference audio' }));
  }
}

export function planAudioMix(plan: RenderPlan, sources: AudioSourceMap): Result<AudioMixPlan> {
  const totalSamples = samplesForFrames(plan.durationFrames, plan.rate, MIX_SAMPLE_RATE);
  const clips: MixSegment[] = [];
  for (const clip of plan.audio) {
    const source = sources.clip(clip.id);
    if (!source) return err(MediaMissing({ name: clip.id }));
    clips.push(clipSegment(clip, plan, source));
  }
  const segments: MixSegment[] = [];
  for (const joined of withSpeechJoins(clips, speechJoins(plan))) {
    const segment = clamp(joined, totalSamples);
    if (segment) segments.push(segment);
  }
  const music = musicSegment(plan, sources, totalSamples);
  if (!music.ok) return music;
  const clamped = music.value ? clamp(music.value, totalSamples) : null;
  if (clamped) segments.push(clamped);
  return ok({
    sampleRate: MIX_SAMPLE_RATE,
    totalSamples,
    segments,
    silent: segments.length === 0,
    music: plan.music.path,
    referenceAudio: segments.some((segment) => segment.kind === 'reference'),
  });
}
