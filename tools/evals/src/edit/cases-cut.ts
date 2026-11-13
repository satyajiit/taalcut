// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the edit eval's cases for the cut: split, delete, duplicate, insert, move, trim, speed and transitions.
 * Clips by index: 0 bike, 1 coffee, 2 crossing, (crossfade), 3 waves, 4 dog, 5 skyline (timeline-doc.ts).
 */
import { defineCases } from './case-types';
import {
  all,
  clipNo,
  clipsOfShot,
  constantSpeed,
  frames,
  near,
  shotOrder,
  speedOf,
  transitionBetween,
} from './check';
import { IDS } from './timeline-doc';

const [BIKE, COFFEE, CROSSING, WAVES, DOG, SKYLINE] = IDS.clips as readonly string[] as [string, string, string, string, string, string];
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const lengths = (clips: readonly { duration: { value: number; rate: { num: number; den: number } } }[]) =>
  clips.map((clip) => frames(clip.duration));

export const CUT_CASES = defineCases([
  {
    id: 'split-this-here',
    family: 'structure',
    pointed: true,
    request: 'Split this clip here.',
    select: [{ clip: 3 }],
    playhead: 7,
    scope: { items: [3], structure: true },
    check: (_before, after) => {
      const waves = lengths(clipsOfShot(after, 'waves'));
      return all(
        [waves.length === 2, `the waves are in ${waves.length} clip(s)`],
        [near(waves[0], 45, 15), `the first half is ${waves[0]} frames, not about 45`],
        [near(sum(waves), 90, 1), `the halves add up to ${sum(waves)} frames`],
      );
    },
  },
  {
    id: 'split-second-in-half',
    family: 'structure',
    request: 'Cut the second clip in half.',
    scope: { items: [1], structure: true },
    check: (_before, after) => {
      const coffee = lengths(clipsOfShot(after, 'coffee'));
      return all(
        [coffee.length === 2, `the coffee shot is in ${coffee.length} clip(s)`],
        [coffee.every((value) => value >= 15 && value <= 30), `the halves are ${coffee.join(' and ')} frames`],
        [near(sum(coffee), 45, 1), `the halves add up to ${sum(coffee)} frames`],
      );
    },
  },
  {
    id: 'delete-this',
    family: 'structure',
    pointed: true,
    request: 'Delete this clip.',
    select: [{ clip: 4 }],
    scope: { items: [4], structure: true },
    check: (_before, after) =>
      all([shotOrder(after).join() === 'bike,coffee,crossing,waves,skyline', `the order is ${shotOrder(after).join()}`]),
  },
  {
    id: 'delete-named',
    family: 'structure',
    request: 'Take the coffee shot out.',
    scope: { items: [1], structure: true },
    check: (_before, after) =>
      all([shotOrder(after).join() === 'bike,crossing,waves,dog,skyline', `the order is ${shotOrder(after).join()}`]),
  },
  {
    id: 'delete-last',
    family: 'structure',
    request: 'Remove the last clip.',
    scope: { items: [5], structure: true },
    check: (_before, after) =>
      all([shotOrder(after).join() === 'bike,coffee,crossing,waves,dog', `the order is ${shotOrder(after).join()}`]),
  },
  {
    id: 'duplicate-this',
    family: 'structure',
    pointed: true,
    request: 'Duplicate this clip.',
    select: [{ clip: 0 }],
    scope: { items: [0], structure: true },
    check: (_before, after) =>
      all([shotOrder(after).join() === 'bike,bike,coffee,crossing,waves,dog,skyline', `the order is ${shotOrder(after).join()}`]),
  },
  {
    id: 'insert-after-named',
    family: 'structure',
    request: 'Put the shot of boats in the harbour right after the dog.',
    scope: { structure: true },
    check: (_before, after) =>
      all([shotOrder(after).join() === 'bike,coffee,crossing,waves,dog,harbour,skyline', `the order is ${shotOrder(after).join()}`]),
  },
  {
    id: 'insert-at-start',
    family: 'structure',
    request: 'Add the shot of a cyclist climbing a hill at the very start, before the bridge.',
    scope: { structure: true },
    check: (_before, after) =>
      all([shotOrder(after).join() === 'hill,bike,coffee,crossing,waves,dog,skyline', `the order is ${shotOrder(after).join()}`]),
  },
  {
    id: 'move-this-to-end',
    family: 'structure',
    pointed: true,
    request: 'Move this clip to the end.',
    select: [{ clip: 1 }],
    scope: { items: [1], structure: true },
    check: (_before, after) =>
      all([shotOrder(after).join() === 'bike,crossing,waves,dog,skyline,coffee', `the order is ${shotOrder(after).join()}`]),
  },
  {
    id: 'move-named-to-start',
    family: 'structure',
    request: 'Move the skyline so the video opens on it.',
    scope: { items: [5], structure: true },
    check: (_before, after) =>
      all([shotOrder(after).join() === 'skyline,bike,coffee,crossing,waves,dog', `the order is ${shotOrder(after).join()}`]),
  },
  {
    id: 'trim-this-beat-shorter',
    family: 'trim',
    pointed: true,
    request: 'Make this clip a beat shorter.',
    select: [{ clip: 3 }],
    // Between two clips a trim rolls the cut: the neighbour on that side takes the frames (the trim model).
    scope: { items: [3, 4], structure: true },
    check: (_before, after) => {
      const length = frames(clipNo(after, 3)?.duration);
      return all([near(length, 75, 1), `the waves are ${length} frames, not 75`]);
    },
  },
  {
    id: 'trim-first-longer',
    family: 'trim',
    request: 'Make the first clip a second longer.',
    scope: { items: [0, 1], structure: true },
    check: (_before, after) => {
      const length = frames(clipNo(after, 0)?.duration);
      return all([near(length, 90, 3), `the bike clip is ${length} frames, not 90`]);
    },
  },
  {
    id: 'trim-to-one-second',
    family: 'trim',
    request: 'Trim the skyline shot down to one second.',
    scope: { items: [4, 5], structure: true },
    check: (_before, after) => {
      const length = frames(clipNo(after, 5)?.duration);
      return all([near(length, 30, 3), `the skyline is ${length} frames, not 30`]);
    },
  },
  {
    id: 'speed-this-half',
    family: 'speed',
    pointed: true,
    request: 'Make this half speed.',
    select: [{ clip: 2 }],
    scope: { items: [2], structure: true },
    check: (_before, after) => all([constantSpeed(clipNo(after, 2), 0.5), `the crossing plays at ${speedOf(clipNo(after, 2))}×`]),
  },
  {
    id: 'speed-quarter',
    family: 'speed',
    request: 'Slow the waves down to a quarter of normal speed.',
    scope: { items: [3], structure: true },
    check: (_before, after) => all([constantSpeed(clipNo(after, 3), 0.25), `the waves play at ${speedOf(clipNo(after, 3))}×`]),
  },
  {
    id: 'speed-double',
    family: 'speed',
    request: 'Make the dog clip play twice as fast.',
    scope: { items: [4], structure: true },
    check: (_before, after) => all([constantSpeed(clipNo(after, 4), 2), `the dog plays at ${speedOf(clipNo(after, 4))}×`]),
  },
  {
    id: 'speed-this-normal',
    family: 'speed',
    pointed: true,
    request: 'Put this clip back to normal speed.',
    select: [{ clip: 5 }],
    setup: [{ name: 'timeline.setSpeed', payload: { clipId: SKYLINE, speed: { kind: 'constant', speed: 0.5 } } }],
    scope: { items: [5], structure: true },
    check: (_before, after) => all([constantSpeed(clipNo(after, 5), 1), `the skyline plays at ${speedOf(clipNo(after, 5))}×`]),
  },
  {
    id: 'speed-this-ramp',
    family: 'speed',
    pointed: true,
    request: 'Ramp this clip from normal speed into slow motion at the end.',
    select: [{ clip: 5 }],
    scope: { items: [5], structure: true },
    check: (_before, after) => {
      const points = clipNo(after, 5)?.speed?.points ?? [];
      return all(
        [points.length >= 2, `the skyline has ${points.length} speed point(s)`],
        [(points[0]?.speed ?? 0) >= 0.9, `it starts at ${points[0]?.speed}×`],
        [(points.at(-1)?.speed ?? 1) <= 0.6, `it ends at ${points.at(-1)?.speed}×`],
      );
    },
  },
  {
    id: 'transition-this-crossfade-next',
    family: 'transition',
    pointed: true,
    request: 'Add a crossfade into the next one.',
    select: [{ clip: 0 }],
    scope: { items: [0, 1] },
    check: (_before, after) =>
      all([transitionBetween(after, BIKE, COFFEE)?.kind === 'dissolve', 'no crossfade between the bike and the coffee']),
  },
  {
    id: 'transition-dip-named',
    family: 'transition',
    request: 'Dip to black between the dog and the skyline.',
    scope: { items: [4, 5] },
    check: (_before, after) =>
      all([transitionBetween(after, DOG, SKYLINE)?.kind === 'fade', 'no dip to black between the dog and the skyline']),
  },
  {
    id: 'transition-whip-after',
    family: 'transition',
    request: 'Put a whip pan after the coffee shot.',
    scope: { items: [1, 2] },
    check: (_before, after) =>
      all([transitionBetween(after, COFFEE, CROSSING)?.kind === 'whip', 'no whip between the coffee and the crossing']),
  },
  {
    id: 'transition-remove',
    family: 'transition',
    request: 'Take the crossfade out and make it a straight cut.',
    scope: { items: [2, 3] },
    check: (_before, after) =>
      all(
        [transitionBetween(after, CROSSING, WAVES) === undefined, 'the crossfade is still there'],
        [shotOrder(after).join() === 'bike,coffee,crossing,waves,dog,skyline', `the order is ${shotOrder(after).join()}`],
      ),
  },
  {
    id: 'transition-longer',
    family: 'transition',
    request: 'Make the crossfade last a full second.',
    scope: { items: [2, 3] },
    check: (_before, after) => {
      const fade = transitionBetween(after, CROSSING, WAVES);
      const length = fade ? frames(fade.inOffset) + frames(fade.outOffset) : 0;
      return all([fade?.kind === 'dissolve', 'the crossfade is gone'], [near(length, 30, 3), `the crossfade is ${length} frames`]);
    },
  },
  {
    id: 'transition-change-kind',
    family: 'transition',
    request: 'Change the crossfade to a zoom.',
    scope: { items: [2, 3] },
    check: (_before, after) =>
      all([transitionBetween(after, CROSSING, WAVES)?.kind === 'zoom', 'no zoom between the crossing and the waves']),
  },
]);
