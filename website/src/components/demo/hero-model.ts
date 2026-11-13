// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Reel, SlotRole } from '#content/schema';
import type { DemoPhase } from '#stores/demo';
import { DEMO } from '#components/hero/copy';
import { formatTimecode, reached } from './pass';
import { confidenceOf, type ConfidenceLevel } from './picks';
import { formatCount } from './roll';

/**
 * The hero's app window, as data (pure; test/unit/demo-hero.test.ts): a row per slot, and the words the status line
 * and the live region say at each step of the pass.
 */

export interface SlotRow {
  readonly index: number;
  readonly role: SlotRole;
  /** What the slot wants, in the reel's words. */
  readonly needs: string;
  readonly level: ConfidenceLevel;
  readonly alternates: number;
  /** Seconds, for the row's length. */
  readonly length: number;
  /** Where the slot starts on the reel, as the app writes it ("0:06.5"). */
  readonly at: string;
  /** The music beats the slot covers, 1-based and inclusive ([12, 12] is one beat). */
  readonly beats: readonly [first: number, last: number] | null;
}

/**
 * The music beats a slot covers: the beats inside it, or, for a slot that falls between two beats (a fast run on the
 * half beat), the beat before it and the one after. Null for a reel without beats.
 */
export function beatSpan(beats: readonly number[], start: number, end: number): readonly [number, number] | null {
  if (beats.length === 0) return null;
  const inside = beats.flatMap((b, i) => (b >= start && b < end ? [i + 1] : []));
  if (inside.length > 0) return [inside[0]!, inside.at(-1)!];
  const after = beats.findIndex((b) => b >= end);
  const before = (after === -1 ? beats.length : after) - 1;
  const first = Math.max(before, 0) + 1;
  return [first, Math.min(first + 1, beats.length)];
}

export function slotRows(reel: Pick<Reel, 'slots' | 'beats'>): SlotRow[] {
  return reel.slots.map((s, index) => ({
    index,
    role: s.role,
    needs: s.needs,
    level: confidenceOf(s),
    alternates: s.pick.alternates,
    length: Math.round((s.end - s.start) * 10) / 10,
    at: formatTimecode(s.start),
    beats: beatSpan(reel.beats, s.start, s.end),
  }));
}

/** The slot list's scroll position that keeps the landing row in view: one row of context above it. */
export function listScrollTop(landing: number, rowHeight: number, visibleRows: number, rows: number): number {
  const max = Math.max(rows - visibleRows, 0) * rowHeight;
  return Math.min(Math.max(landing - 1, 0) * rowHeight, max);
}

/** The status line at the foot of the window: where the pass is, in the app's words. */
export function statusLine(phase: DemoPhase, landed: number, slots: number, clips: number): string {
  const count = formatCount(clips);
  switch (phase) {
    case 'shelf':
      return DEMO.status.shelf;
    case 'lift':
      return DEMO.status.lift;
    case 'template':
      return DEMO.status.template;
    case 'sift':
      return DEMO.status.sift(count);
    case 'assembled':
      return DEMO.status.assembled(landed, slots);
    case 'ready':
      return DEMO.status.ready(slots);
    case 'approved':
      return DEMO.status.approved;
  }
}

/**
 * What the live region says when the pass reaches a phase: once a step, never once a beat. Empty before the template
 * is taken (nothing has happened yet) and while the bar lifts.
 */
export function liveLine(phase: DemoPhase, slots: number, beats: number, clips: number): string {
  if (!reached(phase, 'template')) return '';
  switch (phase) {
    case 'template':
      return DEMO.live.template(slots);
    case 'sift':
      return DEMO.live.sift(beats, formatCount(clips));
    case 'assembled':
      return DEMO.live.assembled;
    case 'ready':
      return DEMO.live.ready;
    default:
      return DEMO.live.approved;
  }
}
