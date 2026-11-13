// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the review should ask about (BRK1 §1, SPEC "Doubts"). The breakdown writes doubts where it isn't sure; the
 * review shows them first and counts what is left. Thresholds are the config's `doubts` and `tempo`.
 *
 * - On a slot (AGT1: also `intentGeneralised`, a name taken out of the intent, transferable-repair.ts): `cutUnsure` (its cut's confidence under `doubts.cutConfidence`: one method found it, or the rule
 *   kept it), `cutMaybeTransition` (the cut came in as a dissolve, whip or flash: maybe one shot),
 *   `fadeTail` (a slot under `doubts.fadeTailSeconds` after a fade), `intentVague` (no subject, no camera motion,
 *   under `doubts.minIntentWords` words, the same words as another slot, or `static` on a shot the breakdown saw
 *   move).
 * - On the reel: `tempoMaybeHalfOrDouble` (as much onset strength between the beats as on them, or a tempo at or
 *   past `tempo.fastBpm` or `tempo.slowBpm`), `speechMaybeHallucinated` (the speech gate's), `soundCreditMissing`
 *   (a linked reel with sound whose platform gave no credit).
 * - On text: `textMaybeScene`, from text-scene.ts.
 */
import { RationalTime, type BeatMap, type Doubt, type FrameRate, type SlotIntent } from '@taalcut/core';
import type { BreakdownConfig } from './config';

type DoubtConfig = Pick<BreakdownConfig, 'doubts' | 'tempo'>;

const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;

/** Mean onset strength at the beats and halfway between them (the envelope at its own rate, `peaks` per second). */
function beatStrengths(
  beatMap: BeatMap,
  envelope: { readonly rate: FrameRate; readonly peaks: readonly number[] },
) {
  const perSecond = envelope.rate.num / envelope.rate.den;
  const at = (seconds: number) => {
    const index = Math.round(seconds * perSecond);
    let best = 0;
    for (let i = index - 1; i <= index + 1; i++) best = Math.max(best, envelope.peaks[i] ?? 0);
    return best;
  };
  const times = beatMap.beats.map((beat) => RationalTime.toSeconds(beat));
  const on = times.map(at);
  const between = times.slice(1).map((time, i) => at((time + times[i]!) / 2));
  const mean = (values: readonly number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return { on: mean(on), between: mean(between) };
}

/** A tempo that may be half or double what is felt; null when the map is steady. */
export function tempoDoubt(
  beatMap: BeatMap | null,
  envelope: { readonly rate: FrameRate; readonly peaks: readonly number[] } | null,
  config: DoubtConfig,
): Doubt | null {
  if (!beatMap || beatMap.bpm === null || beatMap.beats.length < 4) return null;
  const { bpm } = beatMap;
  if (bpm >= config.tempo.fastBpm || bpm <= config.tempo.slowBpm) {
    const past = bpm >= config.tempo.fastBpm ? bpm / config.tempo.fastBpm : config.tempo.slowBpm / bpm;
    return { reason: 'tempoMaybeHalfOrDouble', confidence: round(0.5 + (past - 1)) };
  }
  if (!envelope || envelope.peaks.length === 0) return null;
  const { on, between } = beatStrengths(beatMap, envelope);
  if (on > 0 && between / on >= config.tempo.halfBeatRatio)
    return { reason: 'tempoMaybeHalfOrDouble', confidence: round(between / on) };
  return null;
}

/** The reel's doubts, in DOUBT_REASONS' order. */
export function reelDoubts(evidence: {
  readonly tempo: Doubt | null;
  readonly speech: boolean;
  readonly linked: boolean;
  readonly hasAudio: boolean;
  readonly sound: { readonly title: string | null; readonly artist: string | null } | null;
}): Doubt[] {
  const doubts: Doubt[] = [];
  if (evidence.speech) doubts.push({ reason: 'speechMaybeHallucinated' });
  if (evidence.tempo) doubts.push(evidence.tempo);
  if (evidence.linked && evidence.hasAudio && !(evidence.sound?.title || evidence.sound?.artist))
    doubts.push({ reason: 'soundCreditMissing' });
  return doubts;
}

const fold = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const wordCount = (text: string) => text.split(/\s+/u).filter((word) => word.length > 0).length;

/**
 * An intent the Analyst wrote that doesn't name a subject, or says what another slot says. FRM1-MOT: its motion is
 * measured, not the Analyst's, so a missing one is `motionUnsure`'s to ask.
 */
export function isVague(intent: SlotIntent, others: readonly SlotIntent[], config: DoubtConfig): boolean {
  if (intent.source !== 'analyst') return false;
  if (!intent.subject?.trim()) return true;
  if (wordCount(intent.text) < config.doubts.minIntentWords) return true;
  const mine = fold(intent.text);
  return others.some((other) => other !== intent && other.source === 'analyst' && fold(other.text) === mine);
}

/** A slot's doubts from its cut, the transition into it, its length and its intent. */
export function slotDoubts(
  slot: {
    readonly first: boolean;
    readonly cut: { readonly confidence: number };
    readonly transition: { readonly kind: string; readonly confidence: number } | null;
    readonly seconds: number;
    readonly intent: SlotIntent;
    /** FRM1-MOT: the camera's move was measured but not surely: the measure's confidence (camera.ts). */
    readonly motionUnsure?: number;
    /** AGT1: templates.setIntents took a name out of the intent with no general word for it. */
    readonly generalised?: boolean;
  },
  intents: readonly SlotIntent[],
  config: DoubtConfig,
): Doubt[] {
  const doubts: Doubt[] = [];
  if (!slot.first && slot.cut.confidence < config.doubts.cutConfidence)
    doubts.push({ reason: 'cutUnsure', confidence: round(1 - slot.cut.confidence) });
  if (!slot.first && slot.transition && slot.transition.kind !== 'fade')
    doubts.push({ reason: 'cutMaybeTransition', confidence: round(slot.transition.confidence) });
  if (!slot.first && slot.transition?.kind === 'fade' && slot.seconds < config.doubts.fadeTailSeconds)
    doubts.push({ reason: 'fadeTail' });
  if (isVague(slot.intent, intents, config)) doubts.push({ reason: 'intentVague' });
  if (slot.generalised) doubts.push({ reason: 'intentGeneralised' });
  if (slot.motionUnsure !== undefined)
    doubts.push({ reason: 'motionUnsure', confidence: round(1 - slot.motionUnsure) });
  return doubts;
}
