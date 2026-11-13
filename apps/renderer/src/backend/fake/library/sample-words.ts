// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model output, file names and speech: data, never translated */

/**
 * What the fake's sample clips (sample-clips.ts) are: their names, cameras, what Taalcut saw in each shot, what is
 * said and written on screen. Times are in seconds from the clip's start; the shots follow the sample media's cuts
 * (sample-media.gen.ts).
 */
import type { CameraMotion, ShotType } from '@taalcut/core';
import type { SampleName } from './sample-media.gen';

/** Where a sample stands in the pipeline: every state the clip page draws from a real clip. */
export type SampleState =
  | 'complete'
  | 'waitingForModels'
  | 'preparing'
  | 'silent'
  | 'ownProxy'
  | 'makingFilmstrip'
  | 'filmstripFailed';

export interface SampleShot {
  readonly description: string;
  readonly shotType: ShotType;
  readonly motion: CameraMotion;
  readonly people?: number;
  readonly text?: string;
  readonly objects: readonly string[];
}

export interface SampleClip {
  /** fakeUlid(KIND.asset, n): far past the generated clips and the edge clips. */
  readonly n: number;
  readonly name: string;
  readonly media: SampleName;
  readonly state: SampleState;
  /** The original as the camera wrote it (the proxy is smaller). */
  readonly original: {
    readonly width: number;
    readonly height: number;
    readonly bytes: number;
    readonly codec: string;
    readonly bitDepth: number;
    readonly hdr: 'none' | 'hlg';
  };
  readonly device: { readonly make: string; readonly model: string };
  readonly place?: { readonly name: string; readonly latitude: number; readonly longitude: number };
  readonly description: string;
  readonly shots: readonly SampleShot[];
  /** [text, from s, to s]. */
  readonly lines: readonly (readonly [string, number, number])[];
  /** The clip's music has a beat the fake marks (audio.beats ran on it). */
  readonly beats: boolean;
  /** What the phone wrote beyond the make and model (LIB1-OEM, sample-phones.ts). */
  readonly phone?: SamplePhone;
}

/** LIB1-OEM: when and where it was shot, and what else the camera named. */
export interface SamplePhone {
  /** When it was shot (UTC epoch ms), when not the fake's usual day before it was added. */
  readonly capturedAt?: number;
  /** The zone it was shot in: its file's, or borrowed from a clip shot nearby. */
  readonly captureOffset?: { readonly minutes: number; readonly from: 'file' | 'nearby' };
  readonly modelCode?: string;
  readonly lens?: string;
  readonly app?: string;
  readonly appDevice?: string;
  readonly captureMode?: string;
}

const IPHONE = { make: 'Apple', model: 'iPhone 16 Pro' };

/**
 * LIB1-OEM: two phone clips as the library reads them (synthetic values). 20260314_113000.mp4: a Galaxy, its UTC
 * time and offset +0200. VID_0001.mp4: written by a camera app, a UTC time only, its zone borrowed from the Galaxy's.
 */
const PHONE_CLIPS: readonly SampleClip[] = [
  {
    n: 90_110,
    name: '20260314_113000.mp4',
    media: 'portrait',
    state: 'complete',
    original: { width: 1080, height: 1920, bytes: 27_500_000, codec: 'hevc', bitDepth: 10, hdr: 'hlg' },
    device: { make: 'Samsung', model: 'Galaxy Example' },
    phone: {
      capturedAt: Date.UTC(2026, 2, 14, 9, 30, 0),
      captureOffset: { minutes: 120, from: 'file' },
      modelCode: 'SM-X000Z',
    },
    description: 'Friends dancing in matching t-shirts to loud music',
    shots: [
      {
        description: 'Friends dancing in matching t-shirts',
        shotType: 'medium',
        motion: 'handheld',
        people: 4,
        objects: ['people', 't-shirts'],
      },
    ],
    lines: [],
    beats: false,
  },
  {
    n: 90_111,
    name: 'VID_0001.mp4',
    media: 'portrait',
    state: 'complete',
    original: { width: 1080, height: 1440, bytes: 12_400_000, codec: 'hevc', bitDepth: 8, hdr: 'none' },
    device: { make: '', model: '' },
    phone: {
      capturedAt: Date.UTC(2026, 2, 14, 7, 15, 0),
      captureOffset: { minutes: 120, from: 'nearby' },
      app: 'Sample Cam',
      appDevice: 'XC01',
    },
    description: 'A few words to the camera on a street',
    shots: [
      {
        description: 'A street seen at eye level',
        shotType: 'wide',
        motion: 'handheld',
        objects: ['street'],
      },
    ],
    lines: [],
    beats: false,
  },
];
const GOA = { name: 'Baga Beach, Goa', latitude: 15.5553, longitude: 73.7517 };

const GOLDEN_HOUR: readonly SampleShot[] = [
  {
    description: 'A sunset sky fading from orange to violet',
    shotType: 'wide',
    motion: 'static',
    objects: ['sky', 'sunset'],
  },
  {
    description: 'Dark teal water rippling under a low evening sky',
    shotType: 'wide',
    motion: 'pan',
    text: 'GOA · DAY 3',
    objects: ['sea', 'water'],
  },
  {
    description: 'Pink lights blurred behind two friends walking the promenade',
    shotType: 'close',
    motion: 'handheld',
    people: 2,
    objects: ['lights', 'people', 'promenade'],
  },
  {
    description: 'The sun low and glowing over the horizon',
    shotType: 'detail',
    motion: 'push-in',
    objects: ['sun', 'horizon'],
  },
];

const AERIAL: readonly SampleShot[] = [
  {
    description: 'The sea from above, slow waves rolling in',
    shotType: 'aerial',
    motion: 'tracking',
    objects: ['sea', 'waves'],
  },
  {
    description: 'Sand dunes in warm side light',
    shotType: 'wide',
    motion: 'pan',
    objects: ['dunes', 'sand'],
  },
  {
    description: 'The sky turning pink over the bay',
    shotType: 'aerial',
    motion: 'pull-out',
    objects: ['sky', 'bay'],
  },
];
const DJI = { make: 'DJI', model: 'Mini 4 Pro' };

const GOLDEN_LINES = [
  ['Golden hour on the way back from the beach.', 0.2, 1.4],
  ['The water looked unreal tonight.', 1.7, 3.0],
  ['Taking this one slow, right to the end.', 3.3, 5.6],
] as const;

export const SAMPLE_CLIPS: readonly SampleClip[] = [
  {
    n: 90_101,
    name: 'IMG_4471.MOV',
    media: 'portrait',
    state: 'complete',
    original: { width: 1080, height: 1920, bytes: 48_213_004, codec: 'hevc', bitDepth: 10, hdr: 'hlg' },
    device: IPHONE,
    place: GOA,
    phone: {
      captureOffset: { minutes: 330, from: 'file' },
      lens: 'iPhone 16 Pro back triple camera 6.765mm f/1.78',
    },
    description: 'Golden hour by the sea in Goa, from the sunset to the first lights of the evening',
    shots: GOLDEN_HOUR,
    lines: GOLDEN_LINES,
    beats: false,
  },
  {
    n: 90_102,
    name: 'DJI_0412.MP4',
    media: 'landscape',
    state: 'complete',
    original: { width: 3840, height: 2160, bytes: 214_806_331, codec: 'h264', bitDepth: 8, hdr: 'none' },
    device: DJI,
    place: { name: 'Morjim, Goa', latitude: 15.6311, longitude: 73.7372 },
    description: 'Aerial footage over the coast and the dunes as the sun goes down',
    shots: AERIAL,
    lines: [],
    beats: true,
  },
  {
    n: 90_103,
    name: 'PXL_20260412_183022.mp4',
    media: 'rotated',
    state: 'complete',
    original: { width: 1080, height: 1920, bytes: 31_402_117, codec: 'h264', bitDepth: 8, hdr: 'none' },
    device: { make: 'Google', model: 'Pixel 9' },
    description: 'A garden path at dusk, filmed with the phone on its side',
    shots: [
      {
        description: 'Leaves moving in the evening breeze',
        shotType: 'close',
        motion: 'handheld',
        objects: ['leaves', 'garden'],
      },
      {
        description: 'A warm lamp glowing at the end of the path',
        shotType: 'medium',
        motion: 'push-in',
        objects: ['lamp', 'path'],
      },
    ],
    lines: [['Almost home.', 0.6, 1.6]],
    beats: false,
  },
  {
    n: 90_104,
    name: 'IMG_4502.MOV',
    media: 'silent',
    state: 'silent',
    original: { width: 1080, height: 1920, bytes: 22_904_510, codec: 'hevc', bitDepth: 8, hdr: 'none' },
    device: IPHONE,
    phone: { captureOffset: { minutes: 330, from: 'file' }, captureMode: 'Time-lapse' },
    description: 'Dunes and a moss-green slope, no sound',
    shots: [
      {
        description: 'Rust-red dunes under a pale sky',
        shotType: 'wide',
        motion: 'static',
        objects: ['dunes'],
      },
      {
        description: 'A slope of green moss up close',
        shotType: 'detail',
        motion: 'tilt',
        objects: ['moss'],
      },
    ],
    lines: [],
    beats: false,
  },
  {
    n: 90_105,
    name: 'IMG_4520.MOV',
    media: 'portrait',
    state: 'waitingForModels',
    original: { width: 1080, height: 1920, bytes: 14_806_920, codec: 'hevc', bitDepth: 10, hdr: 'hlg' },
    device: IPHONE,
    description: '',
    shots: GOLDEN_HOUR,
    lines: GOLDEN_LINES,
    beats: false,
  },
  {
    n: 90_106,
    name: 'IMG_4533.MOV',
    media: 'silent',
    state: 'preparing',
    original: { width: 1080, height: 1920, bytes: 39_115_002, codec: 'hevc', bitDepth: 10, hdr: 'hlg' },
    device: IPHONE,
    description: '',
    shots: [],
    lines: [],
    beats: false,
  },
  {
    n: 90_107,
    name: 'WhatsApp Video 2026-10-02.mp4',
    media: 'rotated',
    state: 'ownProxy',
    original: { width: 720, height: 1280, bytes: 1_904_331, codec: 'h264', bitDepth: 8, hdr: 'none' },
    device: { make: '', model: '' },
    description: 'A garden path at dusk, sent on WhatsApp',
    shots: [
      {
        description: 'Leaves moving in the breeze',
        shotType: 'close',
        motion: 'handheld',
        objects: ['leaves'],
      },
      { description: 'A lamp at the end of a path', shotType: 'medium', motion: 'static', objects: ['lamp'] },
    ],
    lines: [],
    beats: false,
  },
  {
    n: 90_108,
    name: 'IMG_4540.MOV',
    media: 'portrait',
    state: 'makingFilmstrip',
    original: { width: 1080, height: 1920, bytes: 51_660_208, codec: 'hevc', bitDepth: 10, hdr: 'hlg' },
    device: IPHONE,
    place: GOA,
    description: 'Golden hour by the sea again, a second take',
    shots: GOLDEN_HOUR,
    lines: GOLDEN_LINES,
    beats: false,
  },
  {
    n: 90_109,
    name: 'DJI_0420.MP4',
    media: 'landscape',
    state: 'filmstripFailed',
    original: { width: 3840, height: 2160, bytes: 198_004_512, codec: 'h264', bitDepth: 8, hdr: 'none' },
    device: DJI,
    description: 'Aerial footage over the coast, a second flight',
    shots: AERIAL,
    lines: [],
    beats: true,
  },
  ...PHONE_CLIPS,
];
