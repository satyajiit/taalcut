// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template v1's invariants (packages/templates/SPEC.md, "Rules"), checked by
 * templateSchema after the shape. Each is reported with its path:
 * - structure times (slots, text, transitions, ramps, anchors, pacing, sheet frames) are at canvas.rate;
 * - slots tile [0, duration) in order, each at least one frame; slot and overlay ids are unique;
 * - text items lie inside [0, duration), last at least one frame, and name an existing slot;
 * - transitionIn is null on slot 0; `before` fits the previous slot, `after` this one;
 * - ramp points start at 0, increase and end inside the slot;
 * - beats increase strictly at beatMap.rate; downbeats are increasing, existing indices;
 * - beatAnchor.beatIndex exists and the beat plus offset is within one frame of slot.start;
 * - version 1 has parentVersion null, later versions a smaller one;
 * - pacing.shotCount equals slots.length; slot.frame and the sheet's frames fit columns × rows.
 */
import type { z } from 'zod';
import type { FrameRate } from '../time/frame-rate';
import { RationalTime } from '../time/rational-time';
import { atMost, lessThan, plus, ruleContext, type Path, type RuleContext } from './rule-helpers';
import type {
  BeatMap,
  Canvas,
  ContactSheet,
  PacingStats,
  SpeedRamp,
  TemplateSlot,
  TextOverlay,
} from './template-parts';

/** The fields the rules read; templateSchema's object satisfies it. */
export interface TemplateShape {
  readonly version: number;
  readonly parentVersion: number | null;
  readonly canvas: Canvas;
  readonly duration: RationalTime;
  readonly slots: readonly TemplateSlot[];
  readonly beatMap: BeatMap | null;
  readonly text: readonly TextOverlay[];
  readonly pacing: PacingStats;
  readonly contactSheet: ContactSheet | null;
}

/** Ramp points start at zero, increase, stay at `rate` and end inside `length`. */
export function checkRamp(
  rules: RuleContext,
  ramp: SpeedRamp,
  length: RationalTime,
  rate: FrameRate,
  path: Path,
): void {
  if (ramp.windowStart) rules.atRate(ramp.windowStart, rate, [...path, 'windowStart']);
  ramp.points.forEach((point, index) => {
    const at = [...path, 'points', index, 'at'];
    if (!rules.atRate(point.at, rate, at)) return;
    if (index === 0 && point.at.value !== 0) rules.issue(at, 'The first ramp point is at zero');
    const previous = ramp.points[index - 1];
    if (previous && !lessThan(previous.at, point.at)) rules.issue(at, 'Ramp points must increase');
    if (!ramp.windowStart && !atMost(point.at, length))
      rules.issue(at, 'Ramp point past the end of its item');
  });
}

/** Beats increase strictly at the map's rate; downbeats are increasing indices into beats. */
export function checkBeatMap(rules: RuleContext, map: BeatMap, path: Path): void {
  map.beats.forEach((beat, index) => {
    if (!rules.atRate(beat, map.rate, [...path, 'beats', index])) return;
    const previous = map.beats[index - 1];
    if (previous && beat.value <= previous.value)
      rules.issue([...path, 'beats', index], 'Beats must increase');
  });
  map.downbeats.forEach((beatIndex, index) => {
    if (beatIndex >= map.beats.length) rules.issue([...path, 'downbeats', index], 'No such beat');
    const previous = map.downbeats[index - 1];
    if (previous !== undefined && beatIndex <= previous)
      rules.issue([...path, 'downbeats', index], 'Downbeats must increase');
  });
}

/** The anchored beat plus its offset lands within one frame of `cut`. */
export function checkAnchor(
  rules: RuleContext,
  anchor: { readonly beatIndex: number; readonly offset: RationalTime },
  map: BeatMap | null,
  cut: RationalTime,
  rate: FrameRate,
  path: Path,
): void {
  if (!rules.atRate(anchor.offset, rate, [...path, 'offset'])) return;
  const beat = map?.beats[anchor.beatIndex];
  if (!beat) return rules.issue([...path, 'beatIndex'], 'No such beat');
  const landed = plus(RationalTime.rescale(beat, rate, 'round'), anchor.offset);
  const off = Math.abs(RationalTime.toFrames(RationalTime.subtract(landed, cut), rate));
  if (off > 1) rules.issue(path, 'The anchored beat is more than one frame from the cut');
}

function checkSlots(rules: RuleContext, template: TemplateShape): void {
  const rate = template.canvas.rate;
  let expected = RationalTime.zero(rate);
  template.slots.forEach((slot, index) => {
    const path = ['slots', index];
    const timed =
      rules.atRate(slot.start, rate, [...path, 'start']) &&
      rules.atRate(slot.duration, rate, [...path, 'duration']);
    if (!timed) return;
    if (!RationalTime.equals(slot.start, expected))
      rules.issue([...path, 'start'], 'Slots must tile the template');
    if (slot.duration.value < 1) rules.issue([...path, 'duration'], 'A slot lasts at least one frame');
    expected = plus(slot.start, slot.duration);
    const previous = template.slots[index - 1];
    if (slot.transitionIn) {
      const at = [...path, 'transitionIn'];
      if (!previous) rules.issue(at, 'The first slot has no transition in');
      if (rules.atRate(slot.transitionIn.before, rate, [...at, 'before']) && previous)
        if (!atMost(slot.transitionIn.before, previous.duration))
          rules.issue([...at, 'before'], 'Transition longer than the previous slot');
      if (rules.atRate(slot.transitionIn.after, rate, [...at, 'after']))
        if (!atMost(slot.transitionIn.after, slot.duration))
          rules.issue([...at, 'after'], 'Transition longer than its slot');
    }
    if (slot.speedRamp) checkRamp(rules, slot.speedRamp, slot.duration, rate, [...path, 'speedRamp']);
    if (slot.beatAnchor)
      checkAnchor(rules, slot.beatAnchor, template.beatMap, slot.start, rate, [...path, 'beatAnchor']);
    const tiles = template.contactSheet ? template.contactSheet.columns * template.contactSheet.rows : 0;
    if (slot.frame !== null && slot.frame >= tiles)
      rules.issue([...path, 'frame'], 'No such contact-sheet tile');
  });
  if (
    rules.atRate(template.duration, rate, ['duration']) &&
    !RationalTime.equals(expected, template.duration)
  )
    rules.issue(['duration'], 'Slots must end at the duration');
}

function checkText(rules: RuleContext, template: TemplateShape, slotIds: ReadonlySet<string>): void {
  const rate = template.canvas.rate;
  template.text.forEach((item, index) => {
    const path = ['text', index];
    if (item.slotId !== null && !slotIds.has(item.slotId)) rules.issue([...path, 'slotId'], 'No such slot');
    const timed =
      rules.atRate(item.start, rate, [...path, 'start']) &&
      rules.atRate(item.duration, rate, [...path, 'duration']);
    if (!timed) return;
    if (item.duration.value < 1) rules.issue([...path, 'duration'], 'Text lasts at least one frame');
    if (item.start.value < 0 || !atMost(plus(item.start, item.duration), template.duration))
      rules.issue(path, 'Text outside the template');
  });
}

function checkSheetAndPacing(
  rules: RuleContext,
  template: TemplateShape,
  slotIds: ReadonlySet<string>,
): void {
  const rate = template.canvas.rate;
  const { pacing, contactSheet } = template;
  if (pacing.shotCount !== template.slots.length)
    rules.issue(['pacing', 'shotCount'], 'shotCount must equal the number of slots');
  for (const key of ['meanShot', 'medianShot', 'shortestShot', 'longestShot', 'hookEnd'] as const)
    rules.atRate(pacing[key], rate, ['pacing', key]);
  if (!contactSheet) return;
  if (contactSheet.frames.length > contactSheet.columns * contactSheet.rows)
    rules.issue(['contactSheet', 'frames'], 'More frames than tiles');
  contactSheet.frames.forEach((frame, index) => {
    rules.atRate(frame.at, rate, ['contactSheet', 'frames', index, 'at']);
    if (frame.slotId !== null && !slotIds.has(frame.slotId))
      rules.issue(['contactSheet', 'frames', index, 'slotId'], 'No such slot');
  });
}

export function checkTemplate(template: TemplateShape, ctx: z.RefinementCtx): void {
  const rules = ruleContext(ctx);
  if (template.version === 1 && template.parentVersion !== null)
    rules.issue(['parentVersion'], 'Version 1 has no parent');
  if (template.version > 1 && (template.parentVersion === null || template.parentVersion >= template.version))
    rules.issue(['parentVersion'], 'A later version names an earlier parent');
  rules.unique(
    template.slots.map((slot) => slot.id),
    (index) => ['slots', index, 'id'],
    'slot',
  );
  rules.unique(
    template.text.map((item) => item.id),
    (index) => ['text', index, 'id'],
    'overlay',
  );
  if (template.beatMap) checkBeatMap(rules, template.beatMap, ['beatMap']);
  checkSlots(rules, template);
  const slotIds = new Set<string>(template.slots.map((slot) => slot.id));
  checkText(rules, template, slotIds);
  checkSheetAndPacing(rules, template, slotIds);
}
