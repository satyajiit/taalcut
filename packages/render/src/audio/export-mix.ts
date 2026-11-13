// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An export's sound with ducking (P3-V6, SPEC P3.9; audio SPEC P3.5). When there is voice and something to
 * duck under it, the dry voice and the un-ducked music and effects are rendered as 48 kHz stems (the same
 * segments and trims as the full mix, sample-aligned), core's DuckingPlanner turns them into gain envelopes
 * (when ducking is on), and the full mix sums each bus with its envelope before Phase 2's two-pass
 * loudness. The planner's check of voice over the ducked music is what QA's `voiceOverMusic` reads; it runs
 * with ducking off too, so a timeline whose music drowns its voice fails with a fix rather than passing.
 * Loudness normalisation scales every bus alike, so the margin it measured holds in the delivered file.
 */
import { rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  ok,
  type AssetId,
  type AsyncResult,
  type AudioTrackRole,
  type DuckingPlanner,
  type TimelineMix,
  type VoiceOverMusicReport,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { RenderPlan } from '../plan/types';
import { gainExpression } from './ducking-apply';
import { mixAudio, renderMix, type MixOptions, type MixResult } from './mix';
import { busedFilterGraph, type BusGains, type MixBus } from './mix-graph';
import { planAudioMix, type AudioSourceMap } from './mix-plan';
import type { AudioMixPlan, MixSegment } from './mix-types';
import { busOfSegment } from './roles';

export interface ExportMixInput {
  readonly plan: RenderPlan;
  /** Each track's role (roles.ts `audioRoles(timeline)`). */
  readonly roles: ReadonlyMap<string, AudioTrackRole>;
  /** The timeline's mix settings (`timeline.mix`). */
  readonly mix: TimelineMix;
  readonly sources: AudioSourceMap;
  /** Audio's planner (core's port); without it the sound is mixed as Phase 2 did and nothing is measured. */
  readonly ducking?: DuckingPlanner;
  /**
   * Which assets' sound carries speech (a transcript with words). Kept clip sound of other assets is ambience,
   * out of the voice stem. Without it all kept clip sound counts as voice.
   */
  readonly speech?: (assetId: AssetId) => boolean;
}

export interface ExportMixResult extends MixResult {
  /** The planner's check of voice over the (ducked) music; null without voice, music or a planner. */
  readonly voiceOverMusic: VoiceOverMusicReport | null;
  /** Whether an envelope was applied to the music or effects. */
  readonly ducked: boolean;
}

const only = (mix: AudioMixPlan, segments: readonly MixSegment[]): AudioMixPlan => ({
  ...mix,
  segments,
  silent: false,
});

interface Stems {
  readonly voice: string;
  readonly music: string | null;
  readonly effects: string | null;
}

/** Each bus alone as float WAV, exactly the mix's length. */
async function renderStems(
  mix: AudioMixPlan,
  busOf: (segment: MixSegment) => MixBus,
  ctx: MediaContext,
  base: string,
  signal: AbortSignal | undefined,
): AsyncResult<Stems & { readonly files: readonly string[] }> {
  const files: string[] = [];
  const stem = async (bus: MixBus): AsyncResult<string | null> => {
    const segments = mix.segments.filter((segment) => busOf(segment) === bus);
    if (segments.length === 0) return ok(null);
    const out = `${base}.${bus}.wav`;
    files.push(out);
    const rendered = await renderMix(only(mix, segments), ctx, { out, ...(signal ? { signal } : {}) });
    return rendered.ok ? ok(out) : rendered;
  };
  const [voice, music, effects] = await Promise.all([stem('voice'), stem('music'), stem('effects')]);
  if (!voice.ok) return voice;
  if (!music.ok) return music;
  if (!effects.ok) return effects;
  return ok({ voice: voice.value ?? '', music: music.value, effects: effects.value, files });
}

/** The music bus with its envelope, for the planner's check (or the stem as it is without one). */
async function duckedMusic(
  mix: AudioMixPlan,
  busOf: (segment: MixSegment) => MixBus,
  gains: BusGains,
  stems: Stems,
  ctx: MediaContext,
  base: string,
  signal: AbortSignal | undefined,
): AsyncResult<string | null> {
  if (!stems.music || !gains.music) return ok(stems.music);
  const music = only(
    mix,
    mix.segments.filter((segment) => busOf(segment) === 'music'),
  );
  const out = `${base}.music-ducked.wav`;
  const rendered = await renderMix(music, ctx, {
    out,
    graph: busedFilterGraph(music, () => 'music', { music: gains.music }),
    ...(signal ? { signal } : {}),
  });
  return rendered.ok ? ok(out) : rendered;
}

/** What ducking adds to a mix: the bused graph (when an envelope moved) and the planner's check. */
interface Ducked {
  readonly mix: AudioMixPlan;
  readonly graph: string | null;
  readonly voiceOverMusic: VoiceOverMusicReport | null;
}

/**
 * The stems, the planner's envelopes and its check, for a mix that has voice and something under it. The
 * stems live next to `base` only while this runs.
 */
async function duck(
  input: ExportMixInput,
  ctx: MediaContext,
  base: string,
  signal: AbortSignal | undefined,
): AsyncResult<Ducked> {
  const planned = planAudioMix(input.plan, input.sources);
  if (!planned.ok) return planned;
  const mix = planned.value;
  const busOf = busOfSegment(input.plan, input.roles, input.speech);
  const has = (bus: MixBus) => mix.segments.some((segment) => busOf(segment) === bus);
  const planner = input.ducking;
  if (mix.silent || !planner || !has('voice') || !(has('music') || has('effects')))
    return ok({ mix, graph: null, voiceOverMusic: null });
  const stems = await renderStems(mix, busOf, ctx, base, signal);
  if (!stems.ok) return stems;
  try {
    const settings = input.mix.ducking;
    let gains: BusGains = {};
    if (settings.enabled) {
      const envelopes = await planner.plan(
        {
          voice: stems.value.voice,
          music: stems.value.music,
          effects: stems.value.effects,
          durationSamples: mix.totalSamples,
          ...(signal ? { signal } : {}),
        },
        settings,
      );
      if (!envelopes.ok) return envelopes;
      const music = gainExpression(envelopes.value.music);
      const effects = gainExpression(envelopes.value.effects);
      gains = { ...(music ? { music } : {}), ...(effects ? { effects } : {}) };
    }
    const ducked = await duckedMusic(mix, busOf, gains, stems.value, ctx, base, signal);
    if (!ducked.ok) return ducked;
    const report = ducked.value
      ? await planner.check(
          { voice: stems.value.voice, duckedMusic: ducked.value, ...(signal ? { signal } : {}) },
          settings.marginLu,
        )
      : ok(null);
    if (!report.ok) return report;
    const graph = Object.keys(gains).length > 0 ? busedFilterGraph(mix, busOf, gains) : null;
    return ok({ mix, graph, voiceOverMusic: report.value });
  } finally {
    const files = [...stems.value.files, `${base}.music-ducked.wav`];
    await Promise.all(files.map((file) => rm(file, { force: true })));
  }
}

const stemBase = (out: string, workDir: string | undefined) =>
  join(workDir ?? dirname(out), `${basename(out)}.stem`);

/**
 * The export's mixed AAC track (P3-V6): ducked under the voice when the timeline asks, then Phase 2's
 * two-pass loudness. Without a planner, voice, or music and effects, it is exactly Phase 2's mixAudio.
 */
export async function mixExport(
  input: ExportMixInput,
  ctx: MediaContext,
  options: MixOptions,
): AsyncResult<ExportMixResult> {
  const ducked = await duck(input, ctx, stemBase(options.out, options.workDir), options.signal);
  if (!ducked.ok) return ducked;
  options.onProgress?.(ducked.value.voiceOverMusic ? 0.3 : 0);
  const from = ducked.value.voiceOverMusic ? 0.3 : 0;
  const mixed = await mixAudio(ducked.value.mix, ctx, {
    ...options,
    ...(ducked.value.graph ? { graph: ducked.value.graph } : {}),
    ...(options.onProgress
      ? { onProgress: (fraction: number) => options.onProgress?.(from + fraction * (1 - from)) }
      : {}),
  });
  if (!mixed.ok) return mixed;
  return ok({
    ...mixed.value,
    voiceOverMusic: ducked.value.voiceOverMusic,
    ducked: ducked.value.graph !== null,
  });
}

/**
 * The same sound as float WAV with no loudness pass, for the preview player (SPEC P3.9: preview and export
 * duck alike). Null when the mix is silent.
 */
export async function renderExportMix(
  input: ExportMixInput,
  ctx: MediaContext,
  options: { readonly out: string; readonly workDir?: string; readonly signal?: AbortSignal },
): AsyncResult<{ readonly path: string; readonly samples: number; readonly ducked: boolean } | null> {
  const ducked = await duck(input, ctx, stemBase(options.out, options.workDir), options.signal);
  if (!ducked.ok) return ducked;
  if (ducked.value.mix.silent) return ok(null);
  const rendered = await renderMix(ducked.value.mix, ctx, {
    out: options.out,
    ...(ducked.value.graph ? { graph: ducked.value.graph } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return rendered.ok ? ok({ ...rendered.value, ducked: ducked.value.graph !== null }) : rendered;
}
