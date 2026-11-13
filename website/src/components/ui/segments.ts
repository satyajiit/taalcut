// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The segment bar's arithmetic (segment-bar.tsx), pure so test/unit/primitives.test.ts can hold it: which slots each
 * part (Hook, Build, Peak, Outro) spans, how full a segment is at a time, where a beat tick sits, and the words the
 * bar is read as.
 */
import type { SlotRole } from '#content/schema';

export interface Segment {
  /** Start and end on the reel's clock, in seconds. */
  readonly start: number;
  readonly end: number;
  /** The part of the reel the slot belongs to. */
  readonly group: SlotRole;
  /** The AI wasn't sure of the cut that opens this slot. */
  readonly unsure?: boolean;
}

export const GROUP_WORDS: Readonly<Record<SlotRole, string>> = { hook: 'Hook', build: 'Build', peak: 'Peak', outro: 'Outro' };

export interface SegmentGroup {
  readonly group: SlotRole;
  /** 1-based slot numbers, inclusive. */
  readonly from: number;
  readonly to: number;
}

/** Runs of neighbouring slots in the same part, in order. */
export function groupsOf(segments: readonly Segment[]): SegmentGroup[] {
  const runs: SegmentGroup[] = [];
  segments.forEach((s, i) => {
    const last = runs.at(-1);
    if (last && last.group === s.group) runs[runs.length - 1] = { ...last, to: i + 1 };
    else runs.push({ group: s.group, from: i + 1, to: i + 1 });
  });
  return runs;
}

/** How full a segment is at time t: 0 before it, 1 after it, linear inside. */
export function segmentFill(segment: Pick<Segment, 'start' | 'end'>, t: number): number {
  const length = segment.end - segment.start;
  if (length <= 0) return t >= segment.end ? 1 : 0;
  return Math.min(1, Math.max(0, (t - segment.start) / length));
}

/**
 * Where a beat at time t sits along the bar, 0 to 1. `equal` bars give each slot the same width (stories style), so
 * the beat lands at its slot's place plus how far into the slot it falls; `time` bars are the reel's clock.
 */
export function beatPosition(segments: readonly Segment[], t: number, layout: 'equal' | 'time'): number {
  const first = segments[0];
  const last = segments.at(-1);
  if (!first || !last) return 0;
  if (layout === 'time') return Math.min(1, Math.max(0, (t - first.start) / (last.end - first.start || 1)));
  const index = segments.findIndex((s) => t >= s.start && t < s.end);
  if (index === -1) return t < first.start ? 0 : 1;
  const s = segments[index]!;
  return (index + segmentFill(s, t)) / segments.length;
}

/** Whether the playhead has just crossed a beat, so its tick swells. */
export function beatPulsing(beat: number, t: number, seconds: number): boolean {
  return t >= beat && t - beat < seconds;
}

/** The words a screen reader gets for the bar: its slots, its parts, its music beats and its doubts. */
export function segmentBarLabel(segments: readonly Segment[], beats: number): string {
  const parts = groupsOf(segments)
    .map((g) => `${GROUP_WORDS[g.group]} ${g.from === g.to ? g.from : `${g.from} to ${g.to}`}`)
    .join(', ');
  const unsure = segments.filter((s) => s.unsure).length;
  const doubt = unsure === 0 ? '' : `; the AI is unsure of ${unsure === 1 ? 'one cut' : `${unsure} cuts`}`;
  const slots = segments.length === 1 ? '1 slot' : `${segments.length} slots`;
  return `Template: ${slots} (${parts})${beats > 0 ? `, ${beats} music beats` : ''}${doubt}`;
}
