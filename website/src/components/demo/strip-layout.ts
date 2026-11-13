// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Reel, Slot, SlotRole } from '#content/schema';

/**
 * Where the template strip's words go (pure; test/unit/demo-strip.test.ts). The strip is measured, never guessed: the
 * component hands in its width in pixels and a function that measures text in its own font, and gets back which role
 * labels fit their run and which timecodes and flags have room. Holds for 1 to 20 slots of any lengths.
 */

export const ROLE_LABEL: Readonly<Record<SlotRole, string>> = { hook: 'Hook', build: 'Build', peak: 'Peak', outro: 'Outro' };

/** A run of consecutive slots with the same role: the strip labels it once, across its combined width. */
export interface RoleRun {
  readonly role: SlotRole;
  /** The run's first and last slot, as indexes into the reel's slots. */
  readonly first: number;
  readonly last: number;
  readonly count: number;
  /** Seconds on the reel's clock. */
  readonly start: number;
  readonly end: number;
}

export function roleRuns(slots: readonly Pick<Slot, 'role' | 'start' | 'end'>[]): RoleRun[] {
  const runs: RoleRun[] = [];
  slots.forEach((slot, i) => {
    const prev = runs[runs.length - 1];
    if (prev && prev.role === slot.role) runs[runs.length - 1] = { ...prev, last: i, count: prev.count + 1, end: slot.end };
    else runs.push({ role: slot.role, first: i, last: i, count: 1, start: slot.start, end: slot.end });
  });
  return runs;
}

/** A run's label, longest first: "Build ×7", then "Build". A run of one is just its role. */
export function runLabels(run: Pick<RoleRun, 'role' | 'count'>): string[] {
  const role = ROLE_LABEL[run.role];
  return run.count > 1 ? [`${role} ×${run.count}`, role] : [role];
}

/** The first label that fits `room` pixels, or null when none does (the label is hidden). */
export function fitLabel(labels: readonly string[], room: number, widthOf: (text: string) => number): string | null {
  return labels.find((label) => widthOf(label) <= room) ?? null;
}

export interface Mark {
  readonly key: string;
  readonly kind: 'timecode' | 'flag';
  readonly text: string;
  /** The anchor in pixels from the strip's left edge: a mark starts there, or ends there when `align` is 'end'. */
  readonly x: number;
  readonly width: number;
  readonly align: 'start' | 'end';
  /** Lower goes first: the start and end, then flags, then the boundaries left to right. */
  readonly priority: number;
}

export interface PlacedMark extends Mark {
  /** The mark's left edge in pixels, kept inside the strip. */
  readonly left: number;
}

export interface PlaceOptions {
  /** The least space between two marks, in pixels. */
  readonly gap?: number;
  /** A timecode closer than this to one already shown is skipped. */
  readonly minStep?: number;
}

/**
 * The marks that fit, highest priority first: each is kept inside the strip and never overlaps one already placed
 * (with `gap` between). A timecode within `minStep` pixels of another timecode is skipped. A flag that would overlap
 * slides along to the nearest free place, at most its own width away, so it stays under its slot.
 */
export function placeMarks(marks: readonly Mark[], stripWidth: number, { gap = 6, minStep = 48 }: PlaceOptions = {}): PlacedMark[] {
  const placed: (PlacedMark & { readonly right: number })[] = [];
  const order = [...marks].sort((a, b) => a.priority - b.priority || a.x - b.x);
  const inside = (left: number, width: number) => Math.min(Math.max(left, 0), stripWidth - width);
  const free = (left: number, width: number) => placed.every((p) => left >= p.right + gap || p.left >= left + width + gap);
  for (const mark of order) {
    if (mark.width > stripWidth) continue;
    const want = inside(mark.align === 'end' ? mark.x - mark.width : mark.x, mark.width);
    let left: number | undefined = free(want, mark.width) ? want : undefined;
    if (left === undefined && mark.kind === 'flag') {
      left = placed
        .flatMap((p) => [p.left - gap - mark.width, p.right + gap])
        .map((l) => inside(l, mark.width))
        .filter((l) => Math.abs(l - want) <= mark.width && free(l, mark.width))
        .sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
    }
    if (left === undefined) continue;
    const crowded = mark.kind === 'timecode' && placed.some((p) => p.kind === 'timecode' && Math.abs(p.x - mark.x) < minStep);
    if (!crowded) placed.push({ ...mark, left, right: left + mark.width });
  }
  return placed.sort((a, b) => a.left - b.left).map(({ right: _right, ...rest }) => rest);
}

/** The text of a flag under an unsure cut. */
export const UNSURE_CUT = 'Unsure cut';
/** A flag's chip around its words: 4 px of padding and a 1 px border each side. */
export const FLAG_CHROME = 10;
/** Every label and timecode starts just after its cut line, so a playhead resting on the cut never crosses it. */
export const AFTER_CUT = 4;

/**
 * The strip's candidate marks: a timecode at the start, at each role boundary and at the end; a flag under each
 * unsure cut. `formatTime` writes a time the way the strip shows it.
 */
export function stripMarks(
  reel: Pick<Reel, 'slots' | 'durationSec'>,
  stripWidth: number,
  widthOf: { readonly timecode: (text: string) => number; readonly flag: (text: string) => number },
  formatTime: (sec: number) => string,
): Mark[] {
  const d = reel.durationSec > 0 ? reel.durationSec : 1;
  const px = (sec: number) => (Math.min(Math.max(sec, 0), d) / d) * stripWidth;
  const end = reel.slots[reel.slots.length - 1]?.end ?? reel.durationSec;
  const timecode = (key: string, sec: number, x: number, align: Mark['align'], priority: number): Mark => {
    const text = formatTime(sec);
    return { key, kind: 'timecode', text, x, width: widthOf.timecode(text), align, priority };
  };
  const marks: Mark[] = [timecode('start', 0, AFTER_CUT, 'start', 0), timecode('end', end, stripWidth, 'end', 0)];
  roleRuns(reel.slots)
    .slice(1)
    .forEach((run, i) => marks.push(timecode(`run-${i + 1}`, run.start, px(run.start) + AFTER_CUT, 'start', 2)));
  reel.slots.forEach((slot, i) => {
    if (slot.uncertainCut) marks.push({ key: `flag-${i}`, kind: 'flag', text: UNSURE_CUT, x: px(slot.start), width: widthOf.flag(UNSURE_CUT) + FLAG_CHROME, align: 'start', priority: 1 });
  });
  return marks;
}

/** How many frames fill a slot `slotWidth` pixels wide with frames `frameWidth` wide, edge to edge (one spare). */
export function filmFrameCount(slotWidth: number, frameWidth: number): number {
  if (!(frameWidth > 0) || !(slotWidth > 0)) return 1;
  return Math.ceil(slotWidth / frameWidth) + 1;
}
