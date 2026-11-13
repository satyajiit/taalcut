// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What each of the site's moods plays, built from the app's acts (kaatu-acts.ts) and moves (kaatu-moves.ts): an
 * opening clip once, the frame it then holds, what keeps it alive while it holds, and the one frame it shows under
 * reduced motion. Also the pace of Kaatu's life. The engine (kaatu-engine.ts) runs these; nothing here touches the page.
 */
import { ANTICS, DOZE, POKES, type Clip, type KaatuAntic } from './kaatu-acts';
import type { KaatuDirection, KaatuFrame } from './kaatu-frames';
import type { KaatuMove } from './kaatu-moves';

export type KaatuMood = 'idle' | 'glance' | 'thinking' | 'delighted' | 'oops' | 'asleep' | 'wave';

export const KAATU_MOODS: readonly KaatuMood[] = ['idle', 'glance', 'thinking', 'delighted', 'oops', 'asleep', 'wave'];

/** Where a glance looks: toward the words or the field beside Kaatu. */
export type KaatuToward = Exclude<KaatuDirection, 'center' | 'up' | 'down'>;

export interface MoodScript {
  /** Played once when the mood starts on screen, with a body move as it starts. */
  readonly opening?: Clip;
  readonly move?: KaatuMove;
  /** The frame held after the opening. */
  readonly home: KaatuFrame;
  /**
   * What happens while it holds: `idle` blinks, looks around, gets up to an antic now and then and dozes off when
   * nothing happens for a while; `blink` only blinks; `think` looks up one way and nibbles, then the other, a beat a
   * second; `still` holds the face.
   */
  readonly life: 'idle' | 'blink' | 'think' | 'still';
  /** The one frame shown under reduced motion: the mood's clearest face. */
  readonly still: KaatuFrame;
  /** The breath's pace: slower and deeper asleep. */
  readonly breath: 'awake' | 'asleep';
}

/** The pace of Kaatu's life, in ms. Uneven on purpose, so nothing ticks. */
export const LIFE = {
  /** A blink every 3 to 6 s, sometimes twice. */
  blink: [3000, 6000],
  doubleBlink: 0.18,
  /** An antic every 8 to 15 s while idle; about one rest in four is a look around instead. */
  antic: [8000, 15_000],
  look: 0.25,
  /** Dozes off after 40 s with no pointer, key or touch, and wakes on the next. */
  doze: 40_000,
  /** A thinking look lasts a beat, as in the app. */
  think: 1000,
  /** Follows the pointer until it rests this long. */
  lookRest: 2400,
  /** This many pokes, each within `quickPoke` of the last, make it dizzy. */
  dizzyAfter: 4,
  quickPoke: 900,
  /** A pointer resting on Kaatu this long makes it shy (once per visit). */
  shy: 1100,
  /** Back from dancing when no beat has come for this long. */
  danceRest: 1400,
} as const;

/** The antics an idle Kaatu picks from: a snack, a yawn, a wave, a wonder and a cheeky tongue. */
export const IDLE_ANTICS: readonly KaatuAntic[] = ['snack', 'yawn', 'wave', 'wonder', 'cheeky'];

const [HEART] = POKES;

export function moodScript(mood: KaatuMood, toward: KaatuToward = 'right'): MoodScript {
  switch (mood) {
    case 'glance':
      return { home: toward, life: 'blink', still: toward, breath: 'awake' };
    case 'thinking':
      return { home: 'up-left', life: 'think', still: 'up-left', breath: 'awake' };
    case 'delighted':
      return { opening: HEART, move: 'hop', home: 'content', life: 'still', still: 'delighted', breath: 'awake' };
    case 'oops':
      return { opening: [{ frame: 'surprised', ms: 900 }], move: 'droop', home: 'content', life: 'still', still: 'surprised', breath: 'awake' };
    case 'asleep':
      return { opening: DOZE, home: 'sleepy', life: 'still', still: 'sleepy', breath: 'asleep' };
    case 'wave':
      return { opening: ANTICS.wave, home: 'center', life: 'idle', still: 'wave', breath: 'awake' };
    case 'idle':
      return { home: 'center', life: 'idle', still: 'center', breath: 'awake' };
  }
}
