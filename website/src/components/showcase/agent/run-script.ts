// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent page's run, as a script in time, on the owner's reel "Vietnam, on repeat" and its clips. The words follow the app's
 * agent and card fixtures (apps/renderer/src/chat/fake-seed.ts "The cut is ready and the check passed. Have a look
 * before it goes out."; the checks' names from packages/ui/src/make/render-words.ts; "Clip 4: new footage" from
 * packages/ui/src/cards/edit-change-words.ts). The check against the reel is AGT2-MATCH's slot match (packages/render
 * SPEC): a slot whose shot misses what its moment needs gets a shot that does ("Use a shot that shows what the moment
 * needs") before the export approval is offered.
 * `frameAt` says what the run shows at a moment, so a replay is a clock and a test can read any frame.
 */

import { reelById } from '#content/reels';

/** The third reel, so the agent's page shows other footage than the home's first one. */
export const REEL = reelById('repeat');

/** The run's name in the chat. */
export const RUN_NAME = 'Make the Vietnam reel';

export const USER_WORDS = 'Make a reel from my Vietnam clips, on the beat of this one.';
export const ATTACHMENT = `Saved reel: ${REEL.title}`;
export const INTRO_WORDS =
  'I’ll read the reel, pick a clip for each slot from your Vietnam clips, and check the cut against the reel before you see it.';
export const WORKING_WORDS = 'Checking the cut against the reel…';
export const OUTRO_WORDS = 'The cut is ready and the check passed. Have a look before it goes out.';

export type StepStatus = 'pending' | 'running' | 'done';

export interface RunStep {
  readonly id: 'read' | 'pick' | 'cut' | 'check';
  readonly text: string;
  /** What it found, once it is done. */
  readonly found: string;
}

export const STEPS: readonly RunStep[] = [
  { id: 'read', text: 'Read the reel', found: 'Its cuts, music beats and the words on screen' },
  { id: 'pick', text: 'Pick a clip for each slot', found: 'One clip per slot from your Vietnam clips' },
  { id: 'cut', text: 'Cut on the beat', found: 'The cuts follow the reel’s music beats' },
  {
    id: 'check',
    text: 'Check the cut against the reel',
    found: 'Two shots swapped, then every check passed',
  },
];

/** The checks against the reel, in the app's words, in the order they pass. */
export const CHECKS: readonly {
  readonly id: 'beat' | 'needs' | 'face' | 'captions' | 'shape';
  readonly name: string;
}[] = [
  { id: 'beat', name: 'Cuts on the beat' },
  { id: 'needs', name: 'Each shot shows what the reel’s moment needs' },
  { id: 'face', name: 'Faces shown or hidden as in the reel' },
  { id: 'captions', name: 'Captions clear of the app’s buttons' },
  { id: 'shape', name: 'Shape (9:16)' },
];

/** Each slot's clip: the breakdown's pick for it (the owner's own clips). */
export const PICKS: readonly string[] = REEL.slots.map((s) => s.pick.clipId);

/** What the agent changed on the timeline this turn, oldest first: Undo takes back the last. */
export interface Change {
  readonly id: string;
  /** The change in the app's words: "Clip 4", "Opening title". */
  readonly target: string;
  readonly what: string;
  /** A clip swap: the slot (0 first), the clip it had, and the one it has now. */
  readonly swap?: { readonly slot: number; readonly before: string; readonly after: string };
  /** What the slot's moment needs, for a swap (the breakdown's words). */
  readonly needs?: string;
}

function swap(slot: number, before: string): Change {
  return {
    id: `clip-${slot + 1}`,
    target: `Clip ${slot + 1}`,
    what: 'new footage',
    swap: { slot, before, after: PICKS[slot] ?? before },
    needs: REEL.slots[slot]?.needs ?? '',
  };
}

/** The check's two swaps: a night street where hands should hold something, a neon lane where a landmark should be held. */
export const CHANGES: readonly Change[] = [
  swap(3, 'vietnam-07'),
  swap(8, 'vietnam-10'),
  { id: 'title', target: 'Opening title', what: 'added, “Six days in Vietnam”' },
];

/** The slots the check swapped, and the change that did it. */
export const SWAPS: ReadonlyMap<number, Change> = new Map(
  CHANGES.flatMap((c) => (c.swap ? [[c.swap.slot, c] as const] : [])),
);

/** The cuts (a slot's start, from the second slot on) that land on a music beat, within 80 ms. */
export const ON_BEAT: readonly number[] = REEL.slots.flatMap((slot, i) =>
  i > 0 && REEL.beats.some((b) => Math.abs(b - slot.start) <= 0.08) ? [i] : [],
);

/** When each part happens, in ms from the start. */
export const AT = {
  pick: 200,
  pickGap: 85,
  cut: 1450,
  seamGap: 40,
  check: 2050,
  /** Cuts on the beat passes. */
  beat: 2250,
  /** The shots are checked against their moments one by one; a missed one is swapped `swapAfter` later. */
  sweep: 2350,
  sweepGap: 90,
  swapAfter: 300,
  /** The last three checks, after the shots. */
  restGap: 200,
} as const;

const SLOTS = REEL.slots.length;
const sweepAt = (k: number) => AT.sweep + k * AT.sweepGap;
const needsPass =
  Math.max(sweepAt(SLOTS - 1), ...[...SWAPS.keys()].map((k) => sweepAt(k) + AT.swapAfter)) + 120;
const checkAt = (c: number) => (c === 0 ? AT.beat : c === 1 ? needsPass : needsPass + (c - 1) * AT.restGap);
export const RUN_END = checkAt(CHECKS.length - 1) + 150;

/** A slot in the strip: its template chip waiting, its clip in, missed by the check, or checked. */
export type SlotState = 'waiting' | 'placed' | 'missed' | 'checked';

export interface RunFrame {
  readonly steps: readonly StepStatus[];
  readonly slots: readonly SlotState[];
  /** Whether each slot has its swapped-in clip (only the swapped slots ever differ). */
  readonly swapped: readonly boolean[];
  /** How many on-beat cuts are marked. */
  readonly seams: number;
  /** How many checks have passed. */
  readonly checks: number;
  readonly done: boolean;
}

/** What the run shows `ms` after it started. Before 0 nothing is picked; from RUN_END on it is finished. */
export function frameAt(ms: number): RunFrame {
  const stepEnds = [0, AT.cut, AT.check, RUN_END];
  const steps = STEPS.map((_, i): StepStatus => {
    const start = i === 0 ? -Infinity : (stepEnds[i - 1] ?? 0);
    const end = i === 0 ? -Infinity : (stepEnds[i] ?? 0);
    return ms >= end ? 'done' : ms >= start ? 'running' : 'pending';
  });
  const slots = REEL.slots.map((_, k): SlotState => {
    if (ms < AT.pick + k * AT.pickGap) return 'waiting';
    if (ms < sweepAt(k)) return 'placed';
    if (SWAPS.has(k) && ms < sweepAt(k) + AT.swapAfter) return 'missed';
    return 'checked';
  });
  const swapped = REEL.slots.map((_, k) => !SWAPS.has(k) || ms >= sweepAt(k) + AT.swapAfter);
  const seams = ms < AT.cut ? 0 : Math.min(ON_BEAT.length, Math.floor((ms - AT.cut) / AT.seamGap) + 1);
  const checks = CHECKS.filter((_, c) => ms >= checkAt(c)).length;
  return { steps, slots, swapped, seams, checks, done: ms >= RUN_END };
}

/** Every moment the run changes, in order: a replay wakes only at these. */
export function frameTimes(): number[] {
  const times = [
    0,
    AT.cut,
    AT.check,
    RUN_END,
    ...REEL.slots.map((_, k) => AT.pick + k * AT.pickGap),
    ...REEL.slots.map((_, k) => sweepAt(k)),
    ...[...SWAPS.keys()].map((k) => sweepAt(k) + AT.swapAfter),
    ...ON_BEAT.map((_, j) => AT.cut + j * AT.seamGap),
    ...CHECKS.map((_, c) => checkAt(c)),
  ];
  return [...new Set(times)].filter((t) => t >= 0).sort((a, b) => a - b);
}

/** The changes still on the timeline, `undone` taken back from the last. */
export function applied(undone: number): readonly Change[] {
  return CHANGES.slice(0, Math.max(0, CHANGES.length - undone));
}

/** The clip each slot shows: a swap taken back shows the clip it had. */
export function clipsWith(frame: RunFrame, undone: number): readonly string[] {
  const kept = new Set(applied(undone).map((c) => c.id));
  return PICKS.map((pick, k) => {
    const change = SWAPS.get(k);
    if (!change?.swap) return pick;
    return frame.swapped[k] && kept.has(change.id) ? change.swap.after : change.swap.before;
  });
}

/** The slots that miss what their moment needs once the run is over: a swap taken back. */
export function missedWith(undone: number): readonly number[] {
  const kept = new Set(applied(undone).map((c) => c.id));
  return [...SWAPS.entries()].filter(([, c]) => !kept.has(c.id)).map(([k]) => k);
}
