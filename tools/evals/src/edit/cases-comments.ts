// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-CMT: the edit eval's comment cases: comments left on the video and sent together ("Send N comments to
 * Taalcut"), so the run is a batch, not a docked message. Each comment's change is checked like a request's, and each
 * must be answered, resolved. The words are made up, shaped like a person's notes; the first is shaped like the owner's
 * (footage that should start a bit earlier because of how it ends). Clips by index: 0 bike, 1 coffee, 2 crossing,
 * 3 waves, 4 dog, 5 skyline.
 */
import type { Clip, GraphicItem } from '@taalcut/core';
import { defineCases } from './case-types';
import { all, clipNo, constantSpeed, frames, graphics, isWarmer, shotByKey, speedOf, textById } from './check';
import { fixedId } from './ids';
import { CLIP_FRAMES, IDS } from './timeline-doc';

const IN_POINT = 90;
const words = (text: string | undefined) => (text ?? '').toLowerCase().replace(/[^a-z ]/g, '').trim();
const ask = (count: number) => `Please make the changes in my ${count} comment${count === 1 ? '' : 's'}.`;
const seeded = (item: GraphicItem) => item.id === fixedId('01K8EG', 1);

/** Clip `index` still plays its shot `key` for its length. */
const kept = (clip: Clip | undefined, index: number, key: string) =>
  [
    [clip?.media.assetId === shotByKey(key).assetId, `clip ${index + 1} no longer plays the ${key} shot`],
    [frames(clip?.duration) === CLIP_FRAMES[index], `clip ${index + 1} is ${frames(clip?.duration)} frames, not ${CLIP_FRAMES[index]}`],
  ] as const;

export const COMMENT_CASES = defineCases([
  {
    id: 'comment-slip-earlier',
    family: 'comments',
    request: ask(1),
    comments: [{ on: { clip: 4 }, body: 'The footage here should start a bit earlier, it ends badly with the dog slowing to a stop.' }],
    scope: { items: [4] },
    check: (_before, after) => {
      const inPoint = frames(clipNo(after, 4)?.sourceStart);
      return all(...kept(clipNo(after, 4), 4, 'dog'), [
        inPoint <= IN_POINT - 15,
        `the dog clip starts at frame ${inPoint}, not earlier than 90`,
      ]);
    },
  },
  {
    id: 'comment-two-speed-title',
    family: 'comments',
    request: ask(2),
    comments: [
      { on: { clip: 1 }, at: 2.5, body: 'Half speed on this one, please.' },
      { on: { text: 'title' }, body: 'Change these words to Sunday ride.' },
    ],
    scope: { items: [1, 'title'], structure: true },
    check: (_before, after) =>
      all(
        [constantSpeed(clipNo(after, 1), 0.5), `the coffee clip plays at ${speedOf(clipNo(after, 1))}×`],
        [words(textById(after, IDS.title)?.text) === 'sunday ride', `the title says ${textById(after, IDS.title)?.text}`],
      ),
  },
  {
    id: 'comment-mute-waves',
    family: 'comments',
    request: ask(1),
    comments: [{ on: { clip: 3 }, at: 6.5, body: 'Mute the sound of the waves on this clip.' }],
    scope: { items: [3] },
    check: (_before, after) => all([clipNo(after, 3)?.audio.muted === true, 'the waves still have their sound']),
  },
  {
    id: 'comment-video-warmer',
    family: 'comments',
    request: ask(1),
    comments: [{ on: 'video', body: 'Make the colours a bit warmer all the way through.' }],
    scope: { items: [0, 1, 2, 3, 4, 5], video: ['grade'] },
    check: (_before, after) => {
      const everyClip = [0, 1, 2, 3, 4, 5].every((index) => isWarmer(clipNo(after, index)?.grade));
      return all([isWarmer(after.grade) || everyClip, 'the video is no warmer']);
    },
  },
  {
    id: 'comment-graphic-words',
    // A graphic's change: held to the graphics bar, not the edits'.
    family: 'graphics',
    request: ask(1),
    comments: [{ on: { graphic: true }, body: 'This should say First morning, not Day one.' }],
    scope: { items: ['graphic'] },
    check: (_before, after) => {
      const seed = graphics(after).find(seeded);
      const title = seed?.composition.params.title;
      const said = typeof title === 'string' ? title : undefined;
      return all([words(said) === 'first morning', `the lower third says ${said}`], [graphics(after).length === 1, `${graphics(after).length} graphics`]);
    },
  },
]);
