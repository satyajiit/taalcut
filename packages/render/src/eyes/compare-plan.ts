// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 eyes: which frames `video.compare` cuts. Each slot asked for, in the template's order, gets its moments: the
 * same share of the slot in the reel (where the template puts it) and in the draft (where its clip sits in the
 * draft's revision), so a slot that runs longer in the draft still pairs its start with the reel's start. Slots are
 * taken whole until the call's rows are used up; the rest are left for another call.
 */
import type { Template } from '@taalcut/core';
import type { SlotFacts, SlotPlace } from '@taalcut/timeline';
import { COMPARE_ROWS_MAX, MOMENT_SHARE, type CompareMoment } from './compare-schema';

/** A frame is cut this far inside a file's end at most: the last frame can be past what the decoder gives. */
const END_MARGIN = 0.05;

export interface PlannedSlot {
  readonly slotId: string;
  readonly facts: SlotFacts;
  /** Where its clip sits now (timeline.get's numbering), and in the draft's revision. */
  readonly now: SlotPlace | null;
  readonly drafted: SlotPlace | null;
  readonly moments: readonly CompareMoment[];
}

export interface PlannedRow {
  readonly slotId: string;
  readonly slot: number;
  readonly moment: CompareMoment;
  readonly reelSeconds: number | null;
  readonly draftSeconds: number | null;
}

/** A row's two stills as cut (null: none, or FFmpeg couldn't), and their artifact ids. */
export interface Cut {
  readonly row: PlannedRow;
  readonly reel: Buffer | null;
  readonly draft: Buffer | null;
  readonly reelImage: string | null;
  readonly draftImage: string | null;
}

export interface ComparePlanInput {
  readonly template: Pick<Template, 'slots'>;
  readonly facts: ReadonlyMap<string, SlotFacts>;
  readonly now: ReadonlyMap<string, SlotPlace>;
  /** The draft's revision of the timeline; null before the first draft. */
  readonly drafted: ReadonlyMap<string, SlotPlace> | null;
  /** Lengths in seconds; null where there is no file to cut from. */
  readonly reelLength: number | null;
  readonly draftLength: number | null;
  readonly slots?: readonly number[];
  readonly moments?: readonly CompareMoment[];
}

const round = (value: number) => Math.round(value * 1000) / 1000;

function inside(at: number, seconds: number, share: number, length: number | null): number | null {
  if (length === null || seconds <= 0) return null;
  const time = at + share * seconds;
  return time > length ? null : round(Math.max(0, Math.min(time, length - END_MARGIN)));
}

export function planCompare(input: ComparePlanInput): {
  readonly slots: readonly PlannedSlot[];
  readonly rows: readonly PlannedRow[];
  readonly left: readonly number[];
} {
  const count = input.template.slots.length;
  const asked = input.slots
    ? [...new Set(input.slots)].sort((a, b) => a - b)
    : input.template.slots.map((_, i) => i + 1);
  const moments = input.moments
    ? [...new Set(input.moments)]
    : asked.length === 1
      ? (['start', 'middle', 'end'] as const)
      : (['middle'] as const);
  const slots: PlannedSlot[] = [];
  const rows: PlannedRow[] = [];
  const left: number[] = [];
  for (const number of asked) {
    const slot = number <= count ? input.template.slots[number - 1] : undefined;
    const facts = slot ? input.facts.get(slot.id) : undefined;
    if (!slot || !facts || rows.length + moments.length > COMPARE_ROWS_MAX) {
      left.push(number);
      continue;
    }
    const drafted = input.drafted?.get(slot.id) ?? null;
    slots.push({ slotId: slot.id, facts, now: input.now.get(slot.id) ?? null, drafted, moments });
    for (const moment of moments) {
      const share = MOMENT_SHARE[moment];
      rows.push({
        slotId: slot.id,
        slot: number,
        moment,
        reelSeconds: inside(facts.reel.at, facts.reel.seconds, share, input.reelLength),
        draftSeconds:
          drafted && drafted.kind === 'clip'
            ? inside(drafted.at, drafted.seconds, share, input.draftLength)
            : null,
      });
    }
  }
  return { slots, rows, left };
}
