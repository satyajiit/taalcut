// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A generated footage library for the indexing e2e (P2-L13): the bundled
 * FFmpeg's lavfi sources cut into shots, 4K and 1080p, H.264 and HEVC, one
 * clip tagged HDR (PQ, BT.2020, 10-bit), portrait and landscape, speech in
 * English and Hindi from macOS `say` (Samantha, Lekha), one silent clip, one
 * music file for the beat tracker and one photo. Made once per machine and
 * kept in TAALCUT_E2E_LIBRARY_CACHE (default Taalcut-dev/e2e-libraries in the
 * OS's cache folder, dev-cache.ts; keyed by LIBRARY_VERSION and scale), since a
 * 10-minute library takes a while to encode. Only a Mac makes it (`say`,
 * VideoToolbox's HEVC); elsewhere the indexing e2e skips unless a library made
 * on a Mac is in the cache (`libraryUnavailable`).
 *
 * `scale` shortens every clip (0.1 makes a one-minute library for the
 * durability test); the full library is ten minutes of video.
 *
 * H.264 is encoded with Apple's software encoder; only HEVC, which the LGPL build
 * cannot encode in software, uses VideoToolbox. Every FFmpeg call runs under
 * the stall watch (tools/bench-footage stall.ts): a stalled one is reported
 * into TAALCUT_VT_STALL_DIR (default Taalcut-dev/vt-stalls in the cache folder) and
 * left running, never killed (brief-common "VideoToolbox stalls").
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runWatched, type StallWatch } from '@taalcut/bench-footage';
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';
import { devCache } from './dev-cache';
import { e2eStallDir } from './indexing-stalls';

const LIBRARY_VERSION = 3;
const SAY = '/usr/bin/say';

/** lavfi sources that look different from each other, so each segment is a shot. */
const LOOKS = [
  'testsrc2=size={W}x{H}:rate={R}',
  'mandelbrot=size={W}x{H}:rate={R}',
  'smptehdbars=size={W}x{H}:rate={R}',
  'gradients=size={W}x{H}:rate={R}:speed=0.02',
  'cellauto=size={W}x{H}:rate={R}:rule=110',
  'life=size={W}x{H}:rate={R}:mold=10:ratio=0.2:death_color=#202060:life_color=#e0a040',
  'rgbtestsrc=size={W}x{H}:rate={R}',
  'testsrc=size={W}x{H}:rate={R}',
] as const;

export interface ClipSpec {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly rate: number;
  readonly seconds: number;
  readonly codec: 'h264' | 'hevc';
  readonly hdr?: boolean;
  /** Spoken over the clip, repeated to fill it. */
  readonly speech?: { readonly voice: 'Samantha' | 'Lekha'; readonly text: string };
}

/** Words the search test looks for: each sits in one clip's speech only. */
export const SPOKEN = {
  lighthouse: 'lighthouse',
  monsoon: 'मानसून',
} as const;

export const LIBRARY: readonly ClipSpec[] = [
  {
    name: 'harbour-4k-hevc.mov',
    ...{ width: 3840, height: 2160, rate: 30, seconds: 60, codec: 'hevc' },
    speech: {
      voice: 'Samantha',
      text: 'We walked along the harbour at dawn. The old lighthouse was still blinking over the grey water, and the fishing boats came in one by one.',
    },
  },
  {
    name: 'market-4k-h264.mp4',
    ...{ width: 3840, height: 2160, rate: 30, seconds: 60, codec: 'h264' },
    speech: {
      voice: 'Lekha',
      text: 'आज हम पुराने बाज़ार में घूमे। मानसून की पहली बारिश हुई और सब लोग चाय की दुकान पर रुक गए।',
    },
  },
  {
    name: 'trail-1080-h264.mp4',
    ...{ width: 1920, height: 1080, rate: 30, seconds: 90, codec: 'h264' },
    speech: {
      voice: 'Samantha',
      text: 'The trail climbed through the pine forest to a waterfall. We stopped for lunch on a flat rock and watched the clouds roll over the ridge.',
    },
  },
  {
    name: 'neon-1080-hdr-hevc.mov',
    ...{ width: 1920, height: 1080, rate: 30, seconds: 60, codec: 'hevc', hdr: true },
  },
  {
    name: 'rooftop-portrait-h264.mp4',
    ...{ width: 1080, height: 1920, rate: 30, seconds: 60, codec: 'h264' },
    speech: {
      voice: 'Lekha',
      text: 'छत से पूरा शहर दिखता है। शाम को आसमान नारंगी हो जाता है और पतंगें उड़ती हैं।',
    },
  },
  {
    name: 'kitchen-1080-h264.mp4',
    ...{ width: 1920, height: 1080, rate: 30, seconds: 120, codec: 'h264' },
    speech: {
      voice: 'Samantha',
      text: 'First we chop the onions and the tomatoes, then the spices go into hot oil. The kitchen smells of cumin and fresh coriander.',
    },
  },
  { name: 'drone-720-silent.mp4', ...{ width: 1280, height: 720, rate: 30, seconds: 90, codec: 'h264' } },
  {
    name: 'beach-1080-hevc.mov',
    ...{ width: 1920, height: 1080, rate: 30, seconds: 60, codec: 'hevc' },
    speech: {
      voice: 'Samantha',
      text: 'The beach was empty at sunset. Waves washed over our feet and the sky turned pink and gold.',
    },
  },
];

/** One FFmpeg call may run this long before the stall watch reports it (and stops waiting; it never kills). */
const STALL_MS = 10 * 60_000;

/** About 12 s per shot, cycling through the looks so neighbours differ. */
function videoGraph(spec: ClipSpec, seconds: number, offset: number): { inputs: string[]; filter: string } {
  const shots = Math.max(1, Math.round(seconds / 12));
  const length = seconds / shots;
  const inputs: string[] = [];
  const labels: string[] = [];
  for (let i = 0; i < shots; i++) {
    const look = LOOKS[(i + offset) % LOOKS.length]!.replaceAll('{W}', String(spec.width))
      .replaceAll('{H}', String(spec.height))
      .replaceAll('{R}', String(spec.rate));
    inputs.push('-f', 'lavfi', '-t', length.toFixed(3), '-i', look);
    labels.push(`[${i}:v]`);
  }
  // PQ / BT.2020 tags on the frames, so the encoder writes them into the stream (HDR as phones tag it).
  const format = spec.hdr
    ? 'format=yuv420p10le,setparams=range=tv:color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc'
    : 'format=yuv420p';
  return {
    inputs,
    filter: `${labels.join('')}concat=n=${shots}:v=1:a=0,${format},setsar=1[v]`,
  };
}

async function speechTrack(
  spec: ClipSpec,
  seconds: number,
  dir: string,
  ffmpeg: string,
  watch: StallWatch,
): Promise<string | undefined> {
  if (!spec.speech) return undefined;
  const aiff = join(dir, `${spec.name}.aiff`);
  // Speech, a pause, again: enough to fill the clip; trimmed to its length below.
  const text = Array.from({ length: 6 }, () => spec.speech!.text).join(' [[slnc 1500]] ');
  execFileSync(SAY, ['-v', spec.speech.voice, '-o', aiff, text], { stdio: 'ignore' });
  const m4a = join(dir, `${spec.name}.m4a`);
  await runWatched(
    ffmpeg,
    [
      '-hide_banner',
      '-v',
      'error',
      '-y',
      '-i',
      aiff,
      '-t',
      String(seconds),
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      m4a,
    ],
    watch,
  );
  return m4a;
}

function encodeArgs(spec: ClipSpec): string[] {
  const common = ['-r', String(spec.rate), '-g', String(spec.rate * 2)];
  if (spec.codec === 'hevc') {
    const hdr = spec.hdr
      ? [
          '-profile:v',
          'main10',
          '-color_primaries',
          'bt2020',
          '-color_trc',
          'smpte2084',
          '-colorspace',
          'bt2020nc',
        ]
      : ['-profile:v', 'main'];
    return [
      '-c:v',
      'hevc_videotoolbox',
      '-tag:v',
      'hvc1',
      '-b:v',
      spec.width > 2000 ? '20M' : '8M',
      ...hdr,
      ...common,
    ];
  }
  // H.264 in software: VideoToolbox's hardware H.264 encoder failed (frame error -17691)
  // and stalled on this library's portrait clip twice on macOS 26.7.1, and the Mac reset after each
  // (_orch/ix/logs/bench/vt-hang-2.md). The library version keys the spec, not the bytes (encoders differ between
  // machines anyway), so existing caches stay valid.
  return [
    ...softwareH264FixtureFlags(),
    '-b:v',
    spec.width > 2000 ? '24M' : '10M',
    '-profile:v',
    'high',
    ...common,
  ];
}

async function makeClip(
  spec: ClipSpec,
  index: number,
  scale: number,
  dirs: { readonly out: string; readonly work: string },
  ffmpeg: string,
  watch: StallWatch,
): Promise<void> {
  const seconds = Math.max(4, Math.round(spec.seconds * scale));
  const { inputs, filter } = videoGraph(spec, seconds, index);
  const audio = await speechTrack(spec, seconds, dirs.work, ffmpeg, watch);
  const audioInputs = audio ? ['-i', audio] : [];
  const audioIndex = inputs.filter((arg) => arg === '-i').length;
  const map = ['-map', '[v]', ...(audio ? ['-map', `${audioIndex}:a`, '-c:a', 'copy'] : ['-an'])];
  const out = join(dirs.out, spec.name);
  await runWatched(
    ffmpeg,
    [
      ...['-hide_banner', '-v', 'error', '-y'],
      ...inputs,
      ...audioInputs,
      ...['-filter_complex', filter],
      ...map,
      ...encodeArgs(spec),
      ...['-t', String(seconds), '-movflags', '+faststart'],
      out,
    ],
    watch,
  );
}

/** A 60 s click track at 120 bpm with an accent every bar: something for the beat tracker. */
async function makeMusic(dir: string, ffmpeg: string, scale: number, watch: StallWatch): Promise<void> {
  const seconds = Math.max(8, Math.round(60 * scale));
  const clicks =
    "aevalsrc='0.6*sin(2*PI*880*t)*exp(-40*mod(t,0.5))*(1+0.8*lt(mod(t,2),0.5))+0.2*sin(2*PI*110*t)':s=44100";
  await runWatched(
    ffmpeg,
    [
      '-hide_banner',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-t',
      String(seconds),
      '-i',
      clicks,
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      join(dir, 'groove-120bpm.m4a'),
    ],
    watch,
  );
}

async function makePhoto(dir: string, ffmpeg: string, watch: StallWatch): Promise<void> {
  await runWatched(
    ffmpeg,
    [
      '-hide_banner',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=4032x3024:rate=1',
      '-frames:v',
      '1',
      '-q:v',
      '2',
      join(dir, 'street-photo.jpg'),
    ],
    watch,
  );
}

export interface GeneratedLibrary {
  readonly dir: string;
  readonly files: readonly string[];
  /** Seconds of video in the library. */
  readonly videoSeconds: number;
}

const libraryCache = (): string => process.env.TAALCUT_E2E_LIBRARY_CACHE?.trim() || devCache('e2e-libraries');
const libraryDir = (scale: number): string =>
  join(libraryCache(), `library-v${LIBRARY_VERSION}-${Math.round(scale * 100)}`);

/**
 * Why this machine can't have the library at `scale` (the reason an indexing e2e skips with), or undefined: it is
 * in the cache already, or this is a Mac, which makes it. The speech is macOS `say`'s Samantha and Lekha (the
 * transcript and language checks read their words), so no other voice stands in for it (LNX1-PKG).
 */
export function libraryUnavailable(scale = 1): string | undefined {
  if (existsSync(join(libraryDir(scale), '.complete')) || existsSync(SAY)) return undefined;
  return `generated library: skipped, its speech needs macOS say (Samantha, Lekha); copy library-v${LIBRARY_VERSION}-${Math.round(scale * 100)} made on a Mac into ${libraryCache()} (TAALCUT_E2E_LIBRARY_CACHE)`;
}

/** The library at `scale`, made now or found from an earlier run. */
export async function generatedLibrary(ffmpegDir: string, scale = 1): Promise<GeneratedLibrary> {
  const dir = libraryDir(scale);
  const videoSeconds = LIBRARY.reduce((sum, spec) => sum + Math.max(4, Math.round(spec.seconds * scale)), 0);
  if (existsSync(join(dir, '.complete')))
    return { dir, files: readdirSync(dir).filter((name) => !name.startsWith('.')), videoSeconds };
  const building = `${dir}.building-${process.pid}`;
  const work = `${building}-work`;
  rmSync(building, { recursive: true, force: true });
  mkdirSync(building, { recursive: true });
  mkdirSync(work, { recursive: true });
  const ffmpeg = join(ffmpegDir, 'ffmpeg');
  const watch: StallWatch = {
    stallMs: STALL_MS,
    reportDir: e2eStallDir(),
  };
  try {
    for (const [index, spec] of LIBRARY.entries())
      await makeClip(spec, index, scale, { out: building, work }, ffmpeg, watch);
    await makeMusic(building, ffmpeg, scale, watch);
    await makePhoto(building, ffmpeg, watch);
    writeFileSync(join(building, '.complete'), String(Date.now()));
    rmSync(dir, { recursive: true, force: true });
    renameSync(building, dir);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(building, { recursive: true, force: true });
  }
  return { dir, files: readdirSync(dir).filter((name) => !name.startsWith('.')), videoSeconds };
}
