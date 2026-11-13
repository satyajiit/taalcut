// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the edit eval's asks of more than one change, and the ones that point with the playhead ("here", "this
 * one" with nothing selected) or a stretch of time. Clips by index: 0 bike, 1 coffee, 2 crossing, 3 waves, 4 dog,
 * 5 skyline.
 */
import { defineCases } from './case-types';
import {
  all,
  clipNo,
  clipsOfShot,
  constantSpeed,
  frames,
  isMono,
  isWarmer,
  musicOf,
  near,
  shotOrder,
  speedOf,
  transitionBetween,
} from './check';
import { IDS } from './timeline-doc';

const [BIKE, COFFEE, CROSSING] = IDS.clips as readonly string[] as [string, string, string];

export const MORE_CASES = defineCases([
  {
    id: 'multi-this-half-crossfade',
    family: 'multi',
    pointed: true,
    request: 'Make this half speed and add a crossfade into the next one.',
    select: [{ clip: 0 }],
    scope: { items: [0, 1], structure: true },
    check: (_before, after) =>
      all(
        [constantSpeed(clipNo(after, 0), 0.5), `the bike plays at ${speedOf(clipNo(after, 0))}×`],
        [transitionBetween(after, BIKE, COFFEE)?.kind === 'dissolve', 'no crossfade between the bike and the coffee'],
      ),
  },
  {
    id: 'multi-delete-mono',
    family: 'multi',
    request: 'Delete the coffee shot and make the bike clip black and white.',
    scope: { items: [0, 1], structure: true },
    check: (_before, after) =>
      all(
        [shotOrder(after).join() === 'bike,crossing,waves,dog,skyline', `the order is ${shotOrder(after).join()}`],
        [isMono(clipNo(after, 0)?.grade), 'the bike clip is still in colour'],
      ),
  },
  {
    id: 'multi-mute-music-fade',
    family: 'multi',
    request: 'Mute the waves and fade the music in over one second.',
    scope: { items: [3], video: ['music'] },
    check: (_before, after) =>
      all(
        [clipNo(after, 3)?.audio.muted === true, 'the waves still have their sound'],
        [near(musicOf(after).fadeIn, 30, 3), `the music fades in over ${musicOf(after).fadeIn} frames`],
      ),
  },
  {
    id: 'multi-split-flash',
    family: 'multi',
    request: 'Split the waves at seven seconds and put a flash between the two halves.',
    scope: { items: [3], structure: true },
    check: (_before, after) => {
      const waves = clipsOfShot(after, 'waves');
      const between = waves.length === 2 ? transitionBetween(after, waves[0]!.id, waves[1]!.id) : undefined;
      return all([waves.length === 2, `the waves are in ${waves.length} clip(s)`], [between?.kind === 'flash', 'no flash between the halves']);
    },
  },
  {
    id: 'multi-slow-fade-out',
    family: 'multi',
    request: 'Slow the skyline down to half speed and fade the music out at the end.',
    scope: { items: [5], structure: true, video: ['music'] },
    check: (_before, after) =>
      all(
        [constantSpeed(clipNo(after, 5), 0.5), `the skyline plays at ${speedOf(clipNo(after, 5))}×`],
        [musicOf(after).fadeOut > 0, 'the music has no fade out'],
      ),
  },
  {
    id: 'multi-fast-warm',
    family: 'multi',
    request: 'Make the dog clip twice as fast and warm its colours up.',
    scope: { items: [4], structure: true },
    check: (_before, after) =>
      all(
        [constantSpeed(clipNo(after, 4), 2), `the dog plays at ${speedOf(clipNo(after, 4))}×`],
        [isWarmer(clipNo(after, 4)?.grade), 'the dog clip is no warmer'],
      ),
  },
  {
    id: 'here-split',
    family: 'structure',
    pointed: true,
    request: 'Split here.',
    playhead: 9,
    scope: { items: [4], structure: true },
    check: (_before, after) => {
      const dog = clipsOfShot(after, 'dog').map((clip) => frames(clip.duration));
      return all([dog.length === 2, `the dog is in ${dog.length} clip(s)`], [near(dog[0], 15, 8), `the first part is ${dog[0]} frames, not about 15`]);
    },
  },
  {
    id: 'here-mono',
    family: 'colour',
    pointed: true,
    request: 'Make this one black and white.',
    playhead: 1,
    scope: { items: [0] },
    check: (_before, after) => all([isMono(clipNo(after, 0)?.grade), 'the bike clip is still in colour']),
  },
  {
    id: 'here-slow',
    family: 'speed',
    pointed: true,
    request: 'Slow this down.',
    playhead: 4.5,
    scope: { items: [2], structure: true },
    check: (_before, after) => {
      const speed = speedOf(clipNo(after, 2));
      return all([speed < 1 && speed >= 0.1, `the crossing plays at ${speed}×`]);
    },
  },
  {
    id: 'here-dip',
    family: 'transition',
    pointed: true,
    request: 'Add a dip to black here.',
    playhead: 3.5,
    scope: { items: [1, 2] },
    check: (_before, after) =>
      all([transitionBetween(after, COFFEE, CROSSING)?.kind === 'fade', 'no dip to black between the coffee and the crossing']),
  },
  {
    id: 'here-mute',
    family: 'sound',
    pointed: true,
    request: "Mute this clip's sound.",
    playhead: 6.5,
    scope: { items: [3] },
    check: (_before, after) => all([clipNo(after, 3)?.audio.muted === true, 'the waves still have their sound']),
  },
  {
    id: 'range-mono',
    family: 'colour',
    pointed: true,
    request: 'Make this part black and white.',
    select: [{ range: [0, 3.5] }],
    scope: { items: [0, 1] },
    check: (_before, after) =>
      all([isMono(clipNo(after, 0)?.grade), 'the bike clip is still in colour'], [isMono(clipNo(after, 1)?.grade), 'the coffee clip is still in colour']),
  },
]);
