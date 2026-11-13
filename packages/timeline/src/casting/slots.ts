// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What casting needs from each template slot: its length and position in
 * canvas frames, where its beat anchor lands relative to its start, the media
 * it consumes (ramps included), its target energy raised by beat density and
 * the canvas orientation shots must match.
 */
import {
  FrameRate,
  RationalTime,
  type CameraMotion,
  type Canvas,
  type Orientation,
  type SlotId,
  type SpeedRamp,
  type Template,
} from '@taalcut/core';
import { slotIntentText } from '@taalcut/templates';
import { rampFrames } from '../model/speed';
import { readAttributes, type Attributes } from './attributes';
import { slotGraphicKinds } from './slot-graphics';
import { slotNeeds, type SlotNeed } from './needs';
import { slotTerms, type GraphicKind, type SlotTerms } from './terms';
import { anchorFrame, beatGrid, type BeatGrid } from '../resync/grid';
import type { CastingConfig } from './config';

export interface SlotSpec {
  readonly index: number;
  readonly slotId: SlotId;
  /** Start and length in canvas frames. */
  readonly start: number;
  readonly frames: number;
  /** Where the beat anchor lands, in canvas frames from the slot's start; null without one. */
  readonly anchorRel: number | null;
  /** The text the intent is embedded from; null when the slot says nothing. */
  readonly intentText: string | null;
  readonly motion: CameraMotion | null;
  /** The slot's energy raised by its beat density, 0..1. */
  readonly energy: number;
  readonly people: number | null;
  readonly subject: string | null;
  /** FIX-CAST: night or day, facing away, indoors or out and the shot size, from the intent's words. */
  readonly attributes: Attributes;
  /** FIX-STORY: the graphics over the slot, by kind (slot-graphics.ts). */
  readonly graphics: readonly GraphicKind[];
  /** FIX-STORY: the things the slot asks for, from its intent's words (terms.ts; FIX-HOOK: graphics add none). */
  readonly terms: SlotTerms;
  /** FIX-HOOK: what its footage must show, as the Analyst stated it (needs.ts); embedded by the cast. */
  readonly needs: readonly SlotNeed[];
  readonly orientation: Orientation;
  readonly speed: SpeedRamp | null;
  /** Media the slot consumes, at the canvas rate (source time; a ramp's integral rounded up). */
  readonly consumes: RationalTime;
}

export function orientationOf(canvas: Pick<Canvas, 'width' | 'height'>): Orientation {
  if (canvas.width === canvas.height) return 'square';
  return canvas.width < canvas.height ? 'portrait' : 'landscape';
}

/**
 * The words the intent is embedded from (its sentence, else its labels; null when it has none): templates'
 * `slotIntentText`, which the template index stores, so fit reads the vector casting would make (LRN1-TPL).
 */
export const intentText = slotIntentText;

/** What the intent says a person would pick by: its line, place and subject, and its shot size (never `reel`). */
export function slotAttributes(intent: Template['slots'][number]['intent']): Attributes {
  if (intent.source === 'pending') return readAttributes('', intent.shotType);
  const words = [intent.text, intent.place ?? '', intent.subject ?? ''].join('. ');
  return readAttributes(words, intent.shotType);
}

function beatsIn(grid: BeatGrid, start: number, end: number): number {
  return grid.beats.filter((beat) => beat >= start && beat < end).length;
}

/** Media a slot of `frames` consumes at `speed`, at the canvas rate. */
export function consumes(frames: number, speed: SpeedRamp | null, rate: FrameRate): RationalTime {
  if (!speed) return RationalTime.of(frames, rate);
  return RationalTime.of(Math.ceil(rampFrames(speed, frames) - 1e-9), rate);
}

export function slotSpecs(template: Template, config: CastingConfig, canvas?: Canvas): SlotSpec[] {
  const rate = template.canvas.rate;
  const grid = beatGrid(template.beatMap, rate, Number.POSITIVE_INFINITY);
  const orientation = orientationOf(canvas ?? template.canvas);
  const fps = FrameRate.toNumber(rate);
  const graphics = slotGraphicKinds(template);
  return template.slots.map((slot, index) => {
    const start = slot.start.value;
    const frames = slot.duration.value;
    const landed = slot.beatAnchor ? anchorFrame(grid, slot.beatAnchor) : null;
    const seconds = frames / fps;
    const beatsPerSecond = seconds > 0 ? beatsIn(grid, start, start + frames) / seconds : 0;
    const lift =
      Math.max(0, beatsPerSecond - config.energy.beatsPerSecondBase) * config.energy.gainPerBeatPerSecond;
    return {
      index,
      slotId: slot.id,
      start,
      frames,
      anchorRel: landed === null ? null : landed - start,
      intentText: intentText(slot),
      motion: slot.intent.motion,
      energy: Math.min(1, slot.intent.energy + lift),
      people: slot.intent.people,
      subject: slot.intent.subject,
      attributes: slotAttributes(slot.intent),
      graphics: graphics[index] ?? [],
      terms: slotTerms(slot.intent.source === 'pending' ? null : slot.intent),
      needs: slotNeeds(slot.intent),
      orientation,
      speed: slot.speedRamp,
      consumes: consumes(frames, slot.speedRamp, rate),
    };
  });
}
