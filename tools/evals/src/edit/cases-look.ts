// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the edit eval's cases for how the video looks and sounds: colour, sound levels and fades, the words on
 * screen, captions and graphics. Clips by index: 0 bike, 1 coffee, 2 crossing, 3 waves, 4 dog, 5 skyline.
 */
import type { GraphicItem } from '@taalcut/core';
import { defineCases } from './case-types';
import { all, clipNo, cueText, frames, graphics, isMono, isWarmer, musicOf, near, textById, voiceClip } from './check';
import { fixedId } from './ids';
import { IDS } from './timeline-doc';

const SKYLINE = IDS.clips[5]!;
const words = (text: string | undefined) => (text ?? '').toLowerCase().replace(/[^a-z ]/g, '').trim();
const titleOf = (item: GraphicItem | undefined) => {
  const title = item?.composition.params.title;
  return title === undefined ? undefined : String(title);
};
/** The lower third the world starts with (world.ts). */
const seeded = (item: GraphicItem) => item.id === fixedId('01K8EG', 1);

export const LOOK_CASES = defineCases([
  {
    id: 'colour-this-mono',
    family: 'colour',
    pointed: true,
    request: 'Make this clip black and white.',
    select: [{ clip: 1 }],
    scope: { items: [1] },
    check: (_before, after) => all([isMono(clipNo(after, 1)?.grade), 'the coffee clip is still in colour']),
  },
  {
    id: 'colour-video-warmer',
    family: 'colour',
    request: 'Make the whole video look warmer.',
    scope: { items: [0, 1, 2, 3, 4, 5], video: ['grade'] },
    check: (_before, after) => {
      const everyClip = [0, 1, 2, 3, 4, 5].every((index) => isWarmer(clipNo(after, index)?.grade));
      return all([isWarmer(after.grade) || everyClip, 'the video is no warmer']);
    },
  },
  {
    id: 'colour-brighten-named',
    family: 'colour',
    request: 'Brighten the dog clip a little.',
    scope: { items: [4] },
    check: (_before, after) => {
      const exposure = clipNo(after, 4)?.grade?.exposure ?? 0;
      return all([exposure > 0 && exposure <= 1, `the dog clip's exposure is ${exposure}`]);
    },
  },
  {
    id: 'colour-look-two',
    family: 'colour',
    request: 'Give both beach shots a vintage look.',
    scope: { items: [3, 4] },
    check: (_before, after) =>
      all(
        [clipNo(after, 3)?.grade?.look === 'vintage', 'the waves have no vintage look'],
        [clipNo(after, 4)?.grade?.look === 'vintage', 'the dog clip has no vintage look'],
      ),
  },
  {
    id: 'colour-this-reset',
    family: 'colour',
    pointed: true,
    request: "Put this clip's colour back to how it was shot.",
    select: [{ clip: 5 }],
    setup: [{ name: 'timeline.setGrade', payload: { target: { kind: 'clips', clipIds: [SKYLINE] }, grade: { saturation: -1 } } }],
    scope: { items: [5] },
    check: (_before, after) => {
      const grade = clipNo(after, 5)?.grade;
      const neutral = !grade || (grade.saturation === 0 && grade.exposure === 0 && grade.look === null);
      return all([neutral, `the skyline still has a grade: ${JSON.stringify(grade)}`]);
    },
  },
  {
    id: 'sound-this-mute',
    family: 'sound',
    pointed: true,
    request: 'Mute this clip.',
    select: [{ clip: 0 }],
    scope: { items: [0] },
    check: (_before, after) => all([clipNo(after, 0)?.audio.muted === true, 'the bike clip still has its sound']),
  },
  {
    id: 'sound-down-6db',
    family: 'sound',
    request: 'Turn the waves down by 6 dB.',
    scope: { items: [3] },
    check: (_before, after) => {
      const gain = clipNo(after, 3)?.audio.gainDb;
      return all([near(gain, -6, 1), `the waves are at ${gain} dB`], [clipNo(after, 3)?.audio.muted === false, 'the waves were muted']);
    },
  },
  {
    id: 'sound-music-fade-out',
    family: 'sound',
    request: 'Fade the music out over the last two seconds.',
    scope: { video: ['music'] },
    check: (_before, after) => {
      const music = musicOf(after);
      return all([near(music.fadeOut, 60, 6), `the music fades out over ${music.fadeOut} frames`], [!music.muted, 'the music was muted']);
    },
  },
  {
    id: 'sound-music-quieter',
    family: 'sound',
    request: 'Make the music quieter.',
    scope: { video: ['music'] },
    check: (_before, after) => {
      const { gainDb, muted } = musicOf(after);
      return all([gainDb < 0 && gainDb >= -20, `the music is at ${gainDb} dB`], [!muted, 'the music was muted']);
    },
  },
  {
    id: 'sound-voice-up',
    family: 'sound',
    request: 'Turn the voice-over up a little.',
    scope: { items: ['voice'] },
    check: (_before, after) => {
      const gain = voiceClip(after)?.audio.gainDb ?? 0;
      return all([gain > 0 && gain <= 6, `the voice line is at ${gain} dB`]);
    },
  },
  {
    id: 'sound-this-fade-in',
    family: 'sound',
    pointed: true,
    request: "Fade this clip's sound in.",
    select: [{ clip: 2 }],
    scope: { items: [2] },
    check: (_before, after) => {
      const fade = frames(clipNo(after, 2)?.audio.fadeIn);
      return all([fade > 0 && fade <= 60, `the crossing fades in over ${fade} frames`]);
    },
  },
  {
    id: 'sound-music-later',
    family: 'sound',
    request: 'Start the music two seconds in.',
    scope: { video: ['music'] },
    check: (_before, after) => {
      const music = musicOf(after);
      return all([near(music.start, 60, 3) || near(music.shift, 60, 3), `the music starts at ${music.start} frames, shifted ${music.shift}`]);
    },
  },
  {
    id: 'sound-unmute-named',
    family: 'sound',
    request: "Turn the coffee clip's own sound on.",
    scope: { items: [1] },
    check: (_before, after) => all([clipNo(after, 1)?.audio.muted === false, 'the coffee clip is still muted']),
  },
  {
    id: 'text-title',
    family: 'text',
    // Like the move below, it names its title: the lower third's own field is a title too.
    request: "Change the Weekend ride title to 'Sunday ride'.",
    scope: { items: ['title'] },
    check: (_before, after) => {
      const text = textById(after, IDS.title)?.text;
      return all([words(text) === 'sunday ride', `the title says ${text}`]);
    },
  },
  {
    id: 'text-this',
    family: 'text',
    pointed: true,
    request: 'Change this text to say Salt air.',
    select: [{ text: 'caption' }],
    scope: { items: ['caption'] },
    check: (_before, after) => {
      const text = textById(after, IDS.caption)?.text;
      return all([words(text) === 'salt air', `the text says ${text}`]);
    },
  },
  {
    id: 'text-move-title',
    family: 'text',
    // The made-up video has two titles, the text and the "Day one" lower third: the request names which one.
    request: 'Move the Weekend ride title down near the bottom of the frame.',
    scope: { items: ['title'] },
    check: (_before, after) => {
      const box = textById(after, IDS.title)?.box;
      return all([(box?.y ?? 0) >= 0.5, `the title is at y ${box?.y}`], [textById(after, IDS.title)?.text === 'Weekend ride', 'the title words changed']);
    },
  },
  {
    id: 'captions-off',
    family: 'captions',
    request: 'Turn the captions off.',
    scope: { video: ['captions'] },
    check: (_before, after) => all([after.captions?.enabled === false, 'the captions are still on']),
  },
  {
    id: 'captions-fix-words',
    family: 'captions',
    request: "The caption that says 'the city was still' should say 'the town was still'.",
    scope: { video: ['captions'] },
    check: (_before, after) =>
      all(
        [words(cueText(after, 1)) === 'the town was still', `the caption says ${cueText(after, 1)}`],
        [words(cueText(after, 0)) === 'we rode out early', `the first caption says ${cueText(after, 0)}`],
      ),
  },
  {
    id: 'graphics-add-lower-third',
    family: 'graphics',
    request: 'Add a lower third that says Day two at six seconds.',
    scope: { video: ['graphics'] },
    // HFW1: a new graphic is the Designer's; the Editor asks for it with the person's words and when it comes on.
    check: (_before, after, asked) => {
      const job = asked.find((entry) => words(entry.request).includes('day two'));
      return all(
        [job !== undefined, `the Designer was asked for ${asked.map((entry) => `"${entry.request}"`).join(', ') || 'nothing'}`],
        [near(job?.at, 6, 0.5), `it comes on at ${job?.at ?? job?.phrase ?? 'no time'}`],
        [graphics(after).some(seeded), 'the lower third that was there is gone'],
      );
    },
  },
  {
    id: 'graphics-edit-words',
    family: 'graphics',
    request: 'Change the lower third to say First morning.',
    scope: { items: ['graphic'] },
    check: (_before, after) => {
      const seed = graphics(after).find(seeded);
      return all([words(titleOf(seed)) === 'first morning', `the lower third says ${titleOf(seed)}`], [graphics(after).length === 1, `${graphics(after).length} graphics`]);
    },
  },
  {
    id: 'graphics-remove',
    family: 'graphics',
    request: 'Take the lower third off.',
    scope: { items: ['graphic'] },
    check: (_before, after) => all([graphics(after).length === 0, `${graphics(after).length} graphic(s) left`]),
  },
  {
    id: 'graphics-add-counter',
    family: 'graphics',
    request: 'Add a counter that goes from 0 to 50 over the skyline.',
    scope: { video: ['graphics'] },
    // HFW1: the Designer's; over the skyline is a time on it (frames 285 to 330) or the skyline clip pointed at.
    check: (_before, after, asked) => {
      const job = asked.find((entry) => /\b0\b.*\b50\b/.test(entry.request));
      const at = job?.at === undefined ? undefined : Math.round(job.at * 30);
      const onSkyline = at !== undefined ? at >= 285 && at <= 330 : job?.target?.kind === 'item' && job.target.itemId === SKYLINE;
      return all(
        [job !== undefined, `the Designer was asked for ${asked.map((entry) => `"${entry.request}"`).join(', ') || 'nothing'}`],
        [onSkyline, `it comes on at ${at !== undefined ? `${at} frames` : JSON.stringify(job?.target ?? job?.phrase ?? null)}`],
      );
    },
  },
]);
