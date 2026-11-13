// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The make flow's journeys (P2-M13, gate criteria 2 and 4): what the user
 * types or picks, the reference reel the desktop e2e makes with FFmpeg, and
 * the library it seeds. The stand-in model (make-flow-script.ts) reads the
 * same data, so a recording against it is a coherent session: the Analyst
 * describes the reel's shots in order, writes intents that match the
 * library's themes, and casting finds them.
 */
import { MAKE_FLOW_COMMENTS_ASK } from './make-flow-comments';
import { CANONICAL_HOME } from './canonical';

/** The reel a reference journey points at, by file name. */
export const MAKE_FLOW_REFERENCE = 'trip-reel.mp4';
/** The swap-then-export journey's reel: another file, so it is another ask. */
export const MAKE_FLOW_SWAP_REFERENCE = 'beach-reel.mp4';
/** The brief-driven journey, typed into the chat (PRD 3, V1). */
export const MAKE_FLOW_BRIEF = 'Make a 30 s vlog of my trip';

/** Where the e2e leaves the reels: the user's Desktop. */
export const REFERENCE_FOLDER = 'Desktop';
export const referencePath = (home: string, file: string): string => `${home}/${REFERENCE_FOLDER}/${file}`;
/** A reel file pasted into the chat (its path): the main model starts the reference flow on it. */
export const referenceAsk = (path: string): string => `Make a video like this reel: ${path}`;
/** The path in a reference ask, if the text is one. */
export const referenceIn = (text: string): string | undefined =>
  /Make a video like this reel: (\S+)/.exec(text)?.[1];

/** As the model sees them: paths under the home folder read /Users/demo (canonical.ts). */
export const MAKE_FLOW_ASKS: readonly string[] = [
  referenceAsk(referencePath(CANONICAL_HOME, MAKE_FLOW_REFERENCE)),
  referenceAsk(referencePath(CANONICAL_HOME, MAKE_FLOW_SWAP_REFERENCE)),
  MAKE_FLOW_BRIEF,
  // EDT1-CMT: the editor's "Send 3 comments to Taalcut" after the brief's export (make-flow-comments.ts).
  MAKE_FLOW_COMMENTS_ASK,
];

export const REFERENCE_RATE = 30;
/** A click every half second: 120 BPM, a beat every 15 frames. */
export const REFERENCE_BPM = 120;
/** The sources are half size; the breakdown's canvas is 1080 wide, so 1080 × 1920. */
export const MEDIA_SIZE = { width: 540, height: 960 } as const;

export type ShotTypeName = 'wide' | 'medium' | 'close' | 'detail' | 'pov';
export type MotionName = 'static' | 'pan' | 'tilt' | 'push-in' | 'pull-out' | 'handheld' | 'tracking';
type Lavfi = (size: string, rate: number) => string;

/** Moving sources, each tinted its own way, so neighbours never look alike and nothing is black or frozen. */
const SOURCES: readonly Lavfi[] = [
  (size, rate) => `testsrc2=size=${size}:rate=${rate}`,
  (size, rate) => `gradients=size=${size}:rate=${rate}:speed=0.08:c0=0x2050c0:c1=0xe0a020`,
  (size, rate) => `zoneplate=size=${size}:rate=${rate}:kt2=4:kx2=64:ky2=64`,
  (size, rate) => `testsrc2=size=${size}:rate=${rate},hue=h=150:s=1.4`,
  (size, rate) => `gradients=size=${size}:rate=${rate}:speed=0.05:c0=0xff7020:c1=0x6020a0:type=radial`,
  (size, rate) => `testsrc2=size=${size}:rate=${rate},hflip,hue=h=260`,
];

/**
 * The reel's shots are stills, one colour each, far apart in hue: within a shot nothing changes, so the
 * breakdown finds exactly the four cuts with both methods and no disputes, the same on every run (moving
 * sources gave a different handful of one-method cuts per encode, which a recorded session can't follow).
 */
const STILLS: readonly Lavfi[] = [0x2050c0, 0xe0a020, 0x20a050, 0xc03080, 0x20c0d0].map(
  (colour) => (size, rate) => `color=c=0x${colour.toString(16).padStart(6, '0')}:size=${size}:rate=${rate}`,
);

export interface ReferenceShot {
  /** Length in frames at REFERENCE_RATE: every cut lands on a beat. */
  readonly frames: number;
  readonly lavfi: Lavfi;
  /** What the stand-in vision model says it sees in the shot. */
  readonly description: string;
  readonly intent: {
    readonly text: string;
    readonly shotType: ShotTypeName;
    readonly motion: MotionName;
    readonly subject: string;
    readonly people: number;
    readonly place: string;
    readonly energy: number;
  };
}

const shot = (
  frames: number,
  still: number,
  description: string,
  intent: ReferenceShot['intent'],
): ReferenceShot => ({ frames, lavfi: STILLS[still]!, description, intent });

/** The reel to copy: five shots, 8 s, every cut on a beat. */
export const REFERENCE_SHOTS: readonly ReferenceShot[] = [
  shot(30, 0, 'A wide shot of a beach with waves rolling in, the camera panning slowly.', {
    text: 'Wide establishing shot of a beach with waves, slow pan',
    shotType: 'wide',
    motion: 'pan',
    subject: 'beach waves',
    people: 0,
    place: 'beach',
    energy: 0.5,
  }),
  shot(45, 1, 'A busy street market with stalls and people walking past.', {
    text: 'Medium handheld shot walking through a busy street market',
    shotType: 'medium',
    motion: 'handheld',
    subject: 'street market stalls',
    people: 4,
    place: 'market',
    energy: 0.7,
  }),
  shot(60, 2, 'A close-up of a plate of street food being served.', {
    text: 'Close-up of street food being served on a plate',
    shotType: 'close',
    motion: 'static',
    subject: 'street food plate',
    people: 1,
    place: 'food stall',
    energy: 0.4,
  }),
  shot(45, 3, 'Friends laughing together around a cafe table.', {
    text: 'Medium shot of friends laughing together at a cafe table',
    shotType: 'medium',
    motion: 'handheld',
    subject: 'friends laughing',
    people: 3,
    place: 'cafe',
    energy: 0.8,
  }),
  shot(60, 4, 'A sunset over the sea, the sky turning orange.', {
    text: 'Wide calm shot of a sunset over the sea',
    shotType: 'wide',
    motion: 'static',
    subject: 'sunset sky',
    people: 0,
    place: 'sea',
    energy: 0.3,
  }),
];

/** The template's name, as the Analyst gives it. */
export const REFERENCE_TEMPLATE_NAME = 'Trip day, beat by beat';

export interface LibraryClip {
  readonly file: string;
  readonly theme: string;
  /** Vision's description of the shot, as the library stores it (and the stand-in embeds it). */
  readonly description: string;
  readonly lavfi: Lavfi;
  readonly shotType: ShotTypeName;
  readonly motion: MotionName;
  readonly objects: readonly string[];
  readonly place: string;
  readonly people: number;
  readonly energy: number;
  readonly quality: number;
}

type ThemeShot = readonly [
  description: string,
  shotType: ShotTypeName,
  motion: MotionName,
  people: number,
  energy: number,
];

interface Theme {
  readonly theme: string;
  readonly place: string;
  readonly objects: readonly string[];
  readonly shots: readonly ThemeShot[];
}

const THEMES: readonly Theme[] = [
  {
    theme: 'beach',
    place: 'beach',
    objects: ['beach', 'waves', 'sand'],
    shots: [
      ['Waves rolling onto a sandy beach, wide view, camera panning', 'wide', 'pan', 0, 0.5],
      ['Footprints on wet sand as a wave washes over the beach', 'close', 'static', 0, 0.4],
      ['Kids running along the beach at the water line', 'wide', 'tracking', 3, 0.85],
    ],
  },
  {
    theme: 'market',
    place: 'market',
    objects: ['market', 'stalls', 'people'],
    shots: [
      ['Walking through a busy street market with stalls and people', 'medium', 'handheld', 5, 0.7],
      ['Spices piled high on a market stall, people bargaining', 'detail', 'handheld', 2, 0.6],
      ['Lanterns hanging over a crowded night market', 'wide', 'tilt', 6, 0.65],
    ],
  },
  {
    theme: 'food',
    place: 'food stall',
    objects: ['food', 'plate'],
    shots: [
      ['Close-up of a plate of street food being served at a stall', 'close', 'static', 1, 0.4],
      ['Friends sharing a plate of food at a street stall', 'medium', 'handheld', 3, 0.6],
      ['A cook flipping flatbread on a hot pan', 'close', 'static', 1, 0.55],
    ],
  },
  {
    theme: 'friends',
    place: 'cafe',
    objects: ['friends', 'table'],
    shots: [
      ['Friends laughing together at a cafe table', 'medium', 'handheld', 3, 0.8],
      ['Friends jumping into the water, laughing', 'wide', 'tracking', 4, 0.95],
      ['A friend smiling at the camera on a scooter ride', 'close', 'handheld', 1, 0.7],
    ],
  },
  {
    theme: 'sunset',
    place: 'sea',
    objects: ['sunset', 'sky', 'sea'],
    shots: [
      ['Sunset over the sea with an orange sky, calm wide view', 'wide', 'static', 0, 0.3],
      ['Palm trees against the sunset sky, slow push-in', 'wide', 'push-in', 0, 0.3],
      ['The sun dipping below the sea horizon', 'wide', 'static', 0, 0.2],
    ],
  },
  {
    theme: 'boat',
    place: 'bay',
    objects: ['boat', 'water'],
    shots: [
      ['A small boat crossing the bay, tracking shot', 'wide', 'tracking', 1, 0.6],
      ['Looking over the side of a boat at blue water', 'pov', 'handheld', 0, 0.5],
      ['Fishing boats moored in the harbour at dawn', 'wide', 'pan', 0, 0.35],
    ],
  },
  {
    theme: 'temple',
    place: 'temple',
    objects: ['temple', 'gate'],
    shots: [
      ['An old temple gate with people walking in, tilt up', 'wide', 'tilt', 4, 0.5],
      ['Candles burning inside a quiet temple', 'detail', 'static', 0, 0.25],
      ['A bell hanging in the temple courtyard', 'medium', 'static', 0, 0.3],
    ],
  },
  {
    theme: 'street',
    place: 'street',
    objects: ['street', 'scooter'],
    shots: [
      ['A scooter riding down a narrow street at dusk', 'medium', 'tracking', 1, 0.75],
      ['A cup of coffee on a cafe table in the morning light', 'detail', 'static', 0, 0.2],
      ['Colourful houses along a winding street, slow pan', 'wide', 'pan', 0, 0.4],
    ],
  },
];

/** The user's trip: 24 portrait clips of 3 s, one shot each, three per theme, in capture order. */
export const LIBRARY_CLIPS: readonly LibraryClip[] = THEMES.flatMap((theme, t) =>
  theme.shots.map(([description, shotType, motion, people, energy], n) => ({
    file: `IMG_${String(101 + t * 3 + n).padStart(4, '0')}.mov`,
    theme: theme.theme,
    description,
    lavfi: SOURCES[(t * 3 + n) % SOURCES.length]!,
    shotType,
    motion,
    objects: theme.objects,
    place: theme.place,
    people,
    energy,
    quality: 0.8 + ((t + n) % 3) * 0.05,
  })),
);

/** Each clip is this long; every slot of the reel and of the 30 s vlog fits inside one. */
export const LIBRARY_CLIP_SECONDS = 3;
