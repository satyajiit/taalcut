// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ on FIX-SIGN: the text stage's record of an overlay (`draft.textRegions`, text-judge.ts) as a fact for its
 * brief: whether the fused evidence called it composited, the scene's or unsure, how likely it is the scene's, the
 * signals that weighed most, in words, and the on-device tie-break's answer. Composited text is a graphic and scene
 * text footage, as the evidence says; the model decides only unsure text, and a composited verdict that rests on the
 * look alone (a sign board on a still camera is an even fill bounded on every side too). Pure.
 */
import { BREAKDOWN_CONFIG } from '../config';
import type { DraftTextRegion } from '../text-judge';
import type { SceneSignal } from '../text-signals';

export interface TextRecord {
  readonly kind: DraftTextRegion['kind'];
  readonly sceneProbability: number;
  /** The tie-break's answer after the job, when it was asked. */
  readonly asked: DraftTextRegion['asked'] | null;
  /**
   * Composited on the look alone (shape, rendered contrast, doubtful words): without them its motion, place and
   * lifetime don't reach FIX-SIGN's composited line. The vision model reads a look better than a sum does.
   */
  readonly lookAlone: boolean;
  /** The strongest signals in words, the strongest first. */
  readonly signals: readonly string[];
  /** The verdict and its strongest signals, for the prompt; a verdict on the look alone is put as unsure. */
  readonly words: string;
}

/** Each signal as the evidence it is, in plain words, with the way it points (FIX-SIGN's table). */
const SIGNAL_WORDS: Readonly<Record<SceneSignal, string>> = {
  withPicture: 'its words move with the picture round them, as scene text does',
  fixedOnPicture: 'it stays put while the picture moves behind it, as a graphic does',
  ownMove: 'it moves on its own while the picture holds, as text on a shirt or a bus does',
  drift: 'its box drifts across the frame, as scene text does',
  covered: 'something covers part of it, as happens to scene text',
  misread: 'it reads differently from frame to frame, as partly hidden scene text does',
  interrupted: 'it goes and comes back at the same place, as scene text does when something passes in front',
  behindPerson: 'a person of the reel covers one end of it, so it is behind them in the scene',
  tilt: 'it is tilted or in perspective, as a sign on a surface is',
  block: 'other lines of other sizes or scripts sit beside it, as on signage',
  vertical: 'its lettering is vertical, as on signage',
  edge: 'the frame’s edge cuts it off, as it does scene text',
  crosses: 'it stays on across a cut, as a graphic does',
  withShot: 'it lives exactly as long as its shot, as scene text often does',
  midShot: 'it comes and goes mid-shot, as a graphic does',
  short: 'it flickers on briefly, as a passing misreading of scene text does',
  crowd: 'it appears with three or more other texts at a cut, as scene text in a busy shot does',
  replaced: 'other words replace it at the same place, as captions do',
  doubtful: 'the text reader was unsure of its words',
  shape: 'it sits on an even fill bounded on every side, as a graphic’s box does, and a sign board too',
  rendered: 'its contrast is a rendered graphic’s',
};

/** FIX-SIGN's look family; the others are motion, occlusion, perspective and lifetime. */
const LOOK = new Set<SceneSignal>(['shape', 'rendered', 'doubtful']);

const VERDICT: Readonly<Record<DraftTextRegion['kind'], string>> = {
  composited: 'added in editing',
  scene: 'part of the filmed scene',
  unsure: 'unsure',
};

/** At most this many signals, the strongest first. */
const SIGNALS = 4;

/** The record of `overlayId` among the draft's text regions, as a fact; null without one. */
export function textRecord(
  regions: readonly DraftTextRegion[] | undefined,
  overlayId: string,
): TextRecord | null {
  const region = regions?.find((item) => item.overlayId === overlayId);
  if (!region) return null;
  const strongest = (Object.entries(region.signals) as [SceneSignal, number][])
    .filter(([, weight]) => Math.abs(weight) >= 0.3)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, SIGNALS)
    .map(([signal]) => SIGNAL_WORDS[signal]);
  const beyondLook = (Object.entries(region.signals) as [SceneSignal, number][])
    .filter(([signal]) => !LOOK.has(signal))
    .reduce((sum, [, weight]) => sum + weight, 0);
  const probability = Math.round(region.sceneProbability * 100) / 100;
  const lookAlone = region.kind === 'composited' && beyondLook > BREAKDOWN_CONFIG.textScene.addedLine;
  // On the look alone FIX-SIGN's probability is the look's: the model gets the signals without it.
  const said = lookAlone ? VERDICT.unsure : `${VERDICT[region.kind]} (scene probability ${probability})`;
  return {
    kind: region.kind,
    sceneProbability: region.sceneProbability,
    asked: region.asked ?? null,
    lookAlone,
    signals: strongest,
    words: strongest.length > 0 ? `${said}: ${strongest.join('; ')}` : said,
  };
}
