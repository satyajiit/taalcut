// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Splits a target's beats among a format's sections (SPEC "Formats"). Every
 * section starts at its preferred size; if that is too long for the target it
 * shrinks in a fixed order (slot lengths toward their minimum, then counts
 * toward their minimum, then to one, then optional sections go, then the hook
 * to one beat); what is left becomes body-length slots in the fill section.
 * A fill may insert `between` slots from the same budget. Constraints run
 * after that shrink order. Deterministic: the same inputs always give the same plan.
 */
import type { AllocationConstraint } from './constraints/types';
import type { FormatSection } from './format-module';

export interface BeatRange {
  readonly min: number;
  readonly pref: number;
  readonly max: number;
}

export interface PlannedSlot {
  readonly section: FormatSection;
  /** Index within its section, and how many slots the section has. */
  readonly index: number;
  readonly count: number;
  readonly beats: number;
}

export interface AllocateOptions {
  readonly seconds: number;
  /** Beats in the hook: 2, or 1 when two beats would be over 1.5 s. */
  readonly hookBeats: number;
  /** Body slots: 2–4 beats up to 30 s targets, 3–6 above. */
  readonly body: BeatRange;
}

interface Part {
  readonly section: FormatSection;
  readonly range: BeatRange;
  lengths: number[];
  betweenLengths: number[];
}

function rangeOf(section: FormatSection, options: AllocateOptions): BeatRange {
  if (section.beats === 'hook') return { min: 1, pref: options.hookBeats, max: options.hookBeats };
  return section.beats === 'body' ? options.body : section.beats;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

function pairKeys(constraints: readonly AllocationConstraint[]): (readonly [string, string])[] {
  return constraints.flatMap((constraint) => (constraint.paired ? [constraint.paired] : []));
}

/** A paired section loses one slot in the same shrink step, so the counts stay level. */
function dropPartner(
  parts: readonly Part[],
  part: Part,
  pairs: readonly (readonly [string, string])[],
): void {
  const pair = pairs.find((keys) => keys[0] === part.section.key || keys[1] === part.section.key);
  if (!pair) return;
  const key = pair[0] === part.section.key ? pair[1] : pair[0];
  const partner = parts.find((candidate) => candidate.section.key === key);
  if (partner && !partner.section.fill && partner.lengths.length > 0) partner.lengths.pop();
}

/** The longest slot above its minimum loses one beat. The latest slot wins a tie. */
function shortenLongest(body: readonly Part[]): boolean {
  let longest: { part: Part; index: number } | undefined;
  for (const part of body) {
    part.lengths.forEach((length, index) => {
      if (length <= part.range.min) return;
      const best = longest ? longest.part.lengths[longest.index] : undefined;
      if (!longest || best === undefined || length >= best) longest = { part, index };
    });
  }
  if (!longest) return false;
  const chosen = longest.part.lengths[longest.index];
  if (chosen !== undefined) longest.part.lengths[longest.index] = chosen - 1;
  return true;
}

/** One shrinking move, or false when this kind of move is used up. */
function shrinkOnce(parts: Part[], pairs: readonly (readonly [string, string])[]): boolean {
  const body = parts.filter((part) => part.section.role !== 'hook');
  if (shortenLongest(body)) return true;
  // 2. Then a section above its minimum count loses a slot (from the end), 3. then down to one.
  for (const floor of [(part: Part) => part.section.count.min, () => 1]) {
    const part = [...body].reverse().find((candidate) => {
      return !candidate.section.fill && candidate.lengths.length > Math.max(1, floor(candidate));
    });
    if (part) {
      part.lengths.pop();
      dropPartner(parts, part, pairs);
      return true;
    }
  }
  // 4. Optional sections go, from the end.
  const optional = [...body].reverse().find((part) => part.section.optional && part.lengths.length > 0);
  if (optional) {
    optional.lengths = [];
    return true;
  }
  // 5. Last, the hook drops to one beat.
  const hook = parts.find((part) => part.section.role === 'hook');
  const hookLength = hook?.lengths[0];
  if (hook && hookLength !== undefined && hookLength > 1) {
    hook.lengths[0] = 1;
    return true;
  }
  return false;
}

/** `rest` beats as body-length slots, longer first (energy rises through the fill). */
export function splitFill(rest: number, range: BeatRange): number[] {
  if (rest < range.min) return [];
  let count = Math.max(1, Math.round(rest / range.pref));
  for (let guard = 0; guard < 1000; guard++) {
    const base = Math.floor(rest / count);
    const extra = rest - base * count;
    if (base > range.max || (base === range.max && extra > 0)) count += 1;
    else if (base < range.min && count > 1) count -= 1;
    else return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0));
  }
  return [rest];
}

function even(total: number, count: number, min: number, max: number): number[] | null {
  if (count === 0) return total === 0 ? [] : null;
  if (total < count * min || total > count * max) return null;
  const base = Math.floor(total / count);
  const extra = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0));
}

function deviation(lengths: readonly number[], pref: number): number {
  if (lengths.length === 0) return 0;
  let total = 0;
  for (const length of lengths) total += Math.abs(length - pref);
  return total / lengths.length;
}

/** N fill slots with N − 1 between slots, both near their preferred length. */
function splitFillBetween(
  rest: number,
  fill: BeatRange,
  between: BeatRange,
): { fill: number[]; between: number[] } | null {
  const prefCost = Math.max(1, fill.pref + between.pref);
  const guess = Math.max(1, Math.round((rest + between.pref) / prefCost));
  const limit = Math.max(guess, Math.ceil(rest / Math.max(1, fill.min)));
  let best: { fill: number[]; between: number[] } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let count = 1; count <= limit; count++) {
    const betweenCount = count - 1;
    const minBetween = betweenCount * between.min;
    const maxBetween = betweenCount * between.max;
    const minFill = count * fill.min;
    const maxFill = count * fill.max;
    if (rest < minFill + minBetween) continue;
    let betweenBeats = Math.min(maxBetween, Math.max(minBetween, betweenCount * between.pref));
    let fillBeats = rest - betweenBeats;
    if (fillBeats > maxFill) {
      const move = Math.min(fillBeats - maxFill, maxBetween - betweenBeats);
      fillBeats -= move;
      betweenBeats += move;
    }
    if (fillBeats < minFill) {
      const move = Math.min(minFill - fillBeats, betweenBeats - minBetween);
      fillBeats += move;
      betweenBeats -= move;
    }
    const fillLengths = even(fillBeats, count, fill.min, fill.max);
    const betweenLengths = even(betweenBeats, betweenCount, between.min, between.max);
    if (!fillLengths || !betweenLengths) continue;
    if (sum(fillLengths) + sum(betweenLengths) !== rest) continue;
    const score =
      deviation(fillLengths, fill.pref) +
      deviation(betweenLengths, between.pref) +
      Math.abs(count - guess) * 0.01;
    if (score < bestScore) {
      best = { fill: fillLengths, between: betweenLengths };
      bestScore = score;
    }
  }
  return best;
}

interface SlotRef {
  readonly part: Part;
  readonly index: number;
  readonly between: boolean;
}

function timeline(parts: readonly Part[]): SlotRef[] {
  const refs: SlotRef[] = [];
  for (const part of parts) {
    part.lengths.forEach((_, index) => {
      refs.push({ part, index, between: false });
      if (part.betweenLengths[index] !== undefined) refs.push({ part, index, between: true });
    });
  }
  return refs;
}

function lengthAt(ref: SlotRef): number | undefined {
  return (ref.between ? ref.part.betweenLengths : ref.part.lengths)[ref.index];
}

function setLength(ref: SlotRef, value: number): void {
  const list = ref.between ? ref.part.betweenLengths : ref.part.lengths;
  list[ref.index] = value;
}

function refRange(ref: SlotRef, options: AllocateOptions): BeatRange {
  const between = ref.between ? ref.part.section.between : undefined;
  return between ? rangeOf(between, options) : ref.part.range;
}

function refRole(ref: SlotRef): FormatSection['role'] {
  return ref.between && ref.part.section.between ? ref.part.section.between.role : ref.part.section.role;
}

function absorbRemainder(parts: Part[], rest: number, options: AllocateOptions): number {
  const refs = timeline(parts);
  let left = rest;
  for (let index = refs.length - 1; index >= 0 && left > 0; index--) {
    const ref = refs[index];
    if (!ref || refRole(ref) === 'hook') continue;
    const current = lengthAt(ref);
    if (current === undefined) continue;
    const add = Math.min(refRange(ref, options).max - current, left);
    if (add > 0) {
      setLength(ref, current + add);
      left -= add;
    }
  }
  const last = refs[refs.length - 1];
  if (left > 0 && last) {
    const current = lengthAt(last);
    if (current !== undefined) setLength(last, current + left);
    left = 0;
  }
  return left;
}

function emit(parts: readonly Part[]): PlannedSlot[] {
  const slots: PlannedSlot[] = [];
  for (const part of parts) {
    const between = part.section.between;
    if (between && part.betweenLengths.length > 0) {
      part.lengths.forEach((beats, index) => {
        slots.push({ section: part.section, index, count: part.lengths.length, beats });
        const cut = part.betweenLengths[index];
        if (cut !== undefined)
          slots.push({ section: between, index, count: part.betweenLengths.length, beats: cut });
      });
      continue;
    }
    part.lengths.forEach((beats, index) => {
      slots.push({ section: part.section, index, count: part.lengths.length, beats });
    });
  }
  return slots;
}

function beatTotal(parts: readonly Part[]): number {
  return sum(parts.flatMap((part) => [...part.lengths, ...part.betweenLengths]));
}

function seedParts(sections: readonly FormatSection[], options: AllocateOptions): Part[] {
  return sections.map((section) => {
    const range = rangeOf(section, options);
    const count = section.fill
      ? 0
      : Math.min(section.count.max, Math.max(section.count.min, section.count.pref(options.seconds)));
    return {
      section,
      range,
      lengths: Array.from({ length: count }, () => range.pref),
      betweenLengths: [],
    };
  });
}

/** Gives the fill (and its between slots) whatever the fixed sections left. */
function placeFill(parts: Part[], rest: number, options: AllocateOptions): number {
  const fill = parts.find((part) => part.section.fill);
  if (!fill) return rest;
  const between = fill.section.between;
  const split =
    between && rest >= fill.range.min ? splitFillBetween(rest, fill.range, rangeOf(between, options)) : null;
  if (split) {
    fill.lengths = split.fill;
    fill.betweenLengths = split.between;
    return rest - sum(split.fill) - sum(split.between);
  }
  fill.lengths = splitFill(rest, fill.range);
  return rest - sum(fill.lengths);
}

function finish(
  parts: Part[],
  rest: number,
  options: AllocateOptions,
  constraints: readonly AllocationConstraint[],
  units: number,
): PlannedSlot[] | null {
  const left = absorbRemainder(parts, placeFill(parts, rest, options), options);
  if (left > 0) return null;
  for (const constraint of constraints) if (!constraint.enforce(parts, units)) return null;
  if (beatTotal(parts) !== units) return null;
  const slots = emit(parts);
  return slots.length === 0 ? null : slots;
}

/** The beat plan for `units` beats. The last slot absorbs a sub-beat remainder. Null when it cannot fit. */
export function allocateBeats(
  sections: readonly FormatSection[],
  units: number,
  options: AllocateOptions,
  constraints: readonly AllocationConstraint[] = [],
): PlannedSlot[] | null {
  const parts = seedParts(sections, options);
  const pairs = pairKeys(constraints);
  const used = () => sum(parts.flatMap((part) => part.lengths));
  while (used() > units) if (!shrinkOnce(parts, pairs)) return null;
  return finish(parts, units - used(), options, constraints, units);
}
