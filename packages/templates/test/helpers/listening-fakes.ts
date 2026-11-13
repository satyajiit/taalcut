// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-C1 fakes: what audio's listening would hear (core's TemplateListening), built from a plan of what answers
 * each cut, so the breakdown's listening stage runs without the CLAP and AST components.
 */
import {
  CUT_SYNC_MISSES,
  err,
  FrameRate,
  ok,
  RationalTime,
  type CutSyncItem,
  type CutSyncStatus,
  type SoundEvent,
  type SoundMeasures,
  type TaalcutError,
  type TemplateListening,
} from '@taalcut/core';
import type { BreakdownAudio } from '../../src/index';

const MS = FrameRate.of(1000);
export const ms = (seconds: number) => RationalTime.fromSeconds(seconds, MS);

export function fakeMeasures(seconds: number): SoundMeasures {
  return {
    duration: ms(seconds),
    lufs: -14,
    truePeakDbtp: -1.2,
    peakDbfs: -1.5,
    lraLu: 6,
    crestLu: 8,
    noiseFloorDbfs: -60,
    nearSilent: false,
    bandwidthHz: 16_000,
    brightnessHz: 2400,
    bands: { sub: -18, low: -8, lowmid: -6, mid: -9, presence: -14, air: -22 },
    sideToMidDb: -12,
    tempo: { bpm: 98, alt: null, clarity: 0.42, confidence: 'clear' },
    key: { tonic: 'A', mode: 'minor', confidence: 0.71 },
  };
}

export function fakeEvent(seconds: number, overrides: Partial<SoundEvent> = {}): SoundEvent {
  return {
    at: ms(seconds),
    shape: 'hit',
    band: 'full',
    contrastDb: 18,
    prominenceDb: 14,
    bedDb: -30,
    peakDbfs: -6,
    lengthMs: 240,
    exposed: true,
    ...overrides,
  };
}

/** What answers one cut: a status, the offset and the event, or nothing (`none`). */
export interface CutPlan {
  readonly status: CutSyncStatus;
  readonly offsetMs?: number;
  readonly event?: Partial<SoundEvent>;
}

/** The listening a plan gives for `cuts` (seconds), with `extra` events between the cuts. */
export function plannedListening(
  cuts: readonly RationalTime[],
  plan: (cutIndex: number, seconds: number) => CutPlan,
  options: {
    readonly seconds?: number;
    readonly extra?: readonly SoundEvent[];
    readonly model?: boolean;
  } = {},
): TemplateListening {
  const events: SoundEvent[] = [...(options.extra ?? [])];
  const items: CutSyncItem[] = cuts.map((cut, cutIndex) => {
    const t = RationalTime.toSeconds(cut);
    const planned = plan(cutIndex, t);
    if (planned.status === 'none' || planned.offsetMs === undefined)
      return { cutIndex, at: ms(t), status: planned.status, offsetMs: null };
    const eventAt = ms(Math.round((t + planned.offsetMs / 1000) * 1000) / 1000);
    const event = fakeEvent(RationalTime.toSeconds(eventAt), planned.event);
    events.push(event);
    return {
      cutIndex,
      at: ms(t),
      status: planned.status,
      offsetMs: planned.offsetMs,
      eventAt,
      prominenceDb: event.prominenceDb,
    };
  });
  const misses: readonly string[] = CUT_SYNC_MISSES;
  const share = (statuses: readonly string[]) =>
    items.length === 0 ? 0 : items.filter((item) => statuses.includes(item.status)).length / items.length;
  return {
    version: 1,
    model:
      options.model === false
        ? null
        : { clap: 'laion/larger_clap_general@16c8cc3', ast: null, dtype: 'int8' },
    measures: fakeMeasures(options.seconds ?? 12),
    events: events.sort((a, b) => RationalTime.toSeconds(a.at) - RationalTime.toSeconds(b.at)),
    sections: [],
    cutSync: {
      items,
      cutsWithoutHit: items.filter((item) => misses.includes(item.status)).map((item) => item.cutIndex),
      okShare: share(['ok']),
      nearShare: share(['ok', 'near']),
      chanceShare: 0.12,
      medianOffsetMs: 20,
      toleranceMs: 33.3,
      onBeatShare: 0.5,
      onBeatChance: 0.16,
    },
    sfxAtCuts: [],
  };
}

/** A listener that hears `plan` and records each call's cuts. */
export function fakeListener(plan: (cutIndex: number, seconds: number) => CutPlan) {
  const calls: { cuts: readonly RationalTime[]; beats: number; frameRate?: FrameRate }[] = [];
  const listen: NonNullable<BreakdownAudio['listen']> = async (input) => {
    calls.push({
      cuts: input.cuts,
      beats: input.beats?.length ?? 0,
      ...(input.frameRate ? { frameRate: input.frameRate } : {}),
    });
    return ok(plannedListening(input.cuts, plan));
  };
  return { listen, calls };
}

/** A listener without its models, as audio answers when CLAP isn't installed (audio's listen/errors.ts). */
export function missingModelListener(): NonNullable<BreakdownAudio['listen']> {
  const missing: TaalcutError = {
    code: 'audio.listen_model_missing',
    messageKey: 'errors.audio.listen_model_missing',
    retryable: false,
    params: { component: 'clap-general-audio' },
  };
  return async () => err(missing);
}
