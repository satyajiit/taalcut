// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The ten generated talking heads of P3-V9's Done-when test (`ten-clips.int.test.ts`): `say` phrases at different
 * rates, fillers the transcript keeps and fillers it drops (as Parakeet and whisper do), and pauses from 250 to
 * 900 ms. Each script starts and ends with silence, so every inner silence is a pause between speech. 36 labels:
 * every filler, and every inner silence of 250 ms or more.
 */
import type { Part } from '../helpers/talking-head';

/** The closed-list fillers these scripts say; every one is a label. */
export const SCRIPT_FILLERS: ReadonlySet<string> = new Set(['um', 'umm', 'uh', 'er', 'erm', 'ah', 'hmm']);

const say = (text: string, rate?: number): Part => ({ say: text, ...(rate ? { rate } : {}) });
/** A filler the transcript leaves out: only the voiced-burst rule can find it. */
const dropped = (text: string, rate: number): Part => ({ say: text, rate, transcribed: false });
const pause = (silenceMs: number): Part => ({ silenceMs });

export const TEN_SCRIPTS: readonly (readonly Part[])[] = [
  [
    pause(300),
    say('Three things nobody tells you about editing'),
    pause(120),
    say('um'),
    pause(600),
    say('the cut follows the beat'),
    pause(400),
    say('and the music follows you'),
    pause(300),
  ],
  [
    pause(300),
    say('Today we are making coffee', 200),
    pause(450),
    say('uh'),
    pause(150),
    say('with a moka pot', 200),
    pause(650),
    say('it takes five minutes', 200),
    pause(300),
  ],
  [
    pause(300),
    say('Pack light for the mountains', 170),
    pause(700),
    say('then add one warm layer', 170),
    pause(140),
    dropped('um', 300),
    pause(300),
    say('and go', 170),
    pause(300),
  ],
  [
    pause(300),
    say('This lens changed everything'),
    pause(250),
    say('uh'),
    pause(250),
    say('for portraits at night'),
    pause(320),
    dropped('erm', 280),
    pause(300),
    say('and in the rain'),
    pause(300),
  ],
  [
    pause(300),
    say('First, clean the board', 220),
    pause(900),
    say('Second, oil the hinges', 220),
    pause(350),
    say('ah'),
    pause(200),
    say('then sand it lightly', 220),
    pause(300),
  ],
  [
    pause(300),
    say('I tried every app for this'),
    pause(150),
    dropped('um', 320),
    pause(150),
    say('and kept one'),
    pause(500),
    say('here is why'),
    pause(300),
  ],
  [
    pause(300),
    say('The secret is the rhythm', 190),
    pause(350),
    say('hmm'),
    pause(350),
    say('not the transitions', 190),
    pause(550),
    say('that is the whole trick', 190),
    pause(300),
  ],
  [
    pause(300),
    say('Grab your camera'),
    pause(600),
    say('um'),
    pause(200),
    say('and a friend'),
    pause(400),
    say('we are going out'),
    pause(300),
  ],
  [
    pause(300),
    say('Morning routine in under a minute', 210),
    pause(280),
    dropped('uh', 280),
    pause(280),
    say('starting now', 210),
    pause(450),
    say('umm', 250),
    pause(300),
    say('see you tomorrow', 210),
    pause(300),
  ],
  [
    pause(300),
    say('Lighting is easier than you think'),
    pause(800),
    say('use the window'),
    pause(160),
    say('er'),
    pause(400),
    say('not the lamp'),
    pause(300),
  ],
];
