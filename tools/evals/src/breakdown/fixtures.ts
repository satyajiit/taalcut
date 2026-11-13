// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { bundledFfmpeg } from '../ffmpeg-bin';
import { writeJson } from '../files';
import { runFfmpeg } from '../ffmpeg-run';
import { h264Route } from '../h264-route';
import { parseGoldenReel, type GoldenReel } from '../schema';

const RATE = 30;
const WIDTH = 180;
const HEIGHT = 320;
/** A click every half second: 120 BPM, a beat every 15 frames. */
const BEAT_FRAMES = 15;

/** One shot: a solid colour, or testsrc2's moving pattern. */
type Shot =
  { readonly frames: number; readonly color: string } | { readonly frames: number; readonly pattern: true };

interface FixtureReel {
  readonly id: string;
  readonly language: 'en' | 'hi' | 'es' | 'pt-BR';
  readonly shots: readonly Shot[];
}

/** Four reels whose hard cuts are in the pixels: each shot starts at a labelled frame. */
const REELS: readonly FixtureReel[] = [
  {
    id: 'bd-red',
    language: 'en',
    shots: [
      { frames: 30, color: 'red' },
      { frames: 30, pattern: true },
    ],
  },
  {
    id: 'bd-green',
    language: 'hi',
    shots: [
      { frames: 24, color: 'green' },
      { frames: 36, color: 'blue' },
      { frames: 30, pattern: true },
    ],
  },
  {
    id: 'bd-blue',
    language: 'es',
    shots: [
      { frames: 15, color: 'blue' },
      { frames: 30, color: 'yellow' },
      { frames: 30, color: 'red' },
      { frames: 15, color: 'green' },
    ],
  },
  {
    id: 'bd-yellow',
    language: 'pt-BR',
    shots: [
      { frames: 40, pattern: true },
      { frames: 35, color: 'yellow' },
    ],
  },
];

function cutsOf(reel: FixtureReel): number[] {
  const cuts: number[] = [];
  let at = 0;
  for (const [index, shot] of reel.shots.entries()) {
    if (index > 0) cuts.push(at);
    at += shot.frames;
  }
  return cuts;
}

const durationOf = (reel: FixtureReel) => reel.shots.reduce((sum, shot) => sum + shot.frames, 0);

function golden(reel: FixtureReel): GoldenReel {
  const cuts = cutsOf(reel);
  const duration = durationOf(reel);
  const bounds = [0, ...cuts, duration];
  const beats = Array.from({ length: Math.ceil(duration / BEAT_FRAMES) }, (_, index) => ({
    frame: index * BEAT_FRAMES,
    kind: index % 4 === 0 ? ('downbeat' as const) : ('beat' as const),
  }));
  return parseGoldenReel({
    reelId: reel.id,
    synthetic: true,
    note: 'Synthetic lavfi reel: hard cuts at the labelled frames, a 120 BPM click track. Labels come from how it was made.',
    source: { label: reel.id, durationFrames: duration, width: WIDTH, height: HEIGHT },
    frameRate: { numerator: RATE, denominator: 1 },
    cuts,
    beats,
    slots: bounds.slice(0, -1).map((start, index) => ({
      id: `shot-${index}`,
      startFrame: start,
      endFrame: bounds[index + 1]!,
      intent: 'synthetic shot',
    })),
    overlays: [],
    transitions: cuts.map((atFrame) => ({ atFrame, kind: 'cut' })),
    audio: { type: 'music' },
    languages: [reel.language],
  });
}

/** Four labelled reels; `source.uri` is filled in by buildBreakdownFixture. */
export const BREAKDOWN_FIXTURE_REELS: readonly GoldenReel[] = REELS.map(golden);

/** The reel's video and click track as filtergraph chains ending in [v<n>] and [a<n>]. */
function reelGraph(reel: FixtureReel, n: number): string[] {
  const size = `${WIDTH}x${HEIGHT}`;
  const parts = reel.shots.map((shot, index) => {
    const source =
      'color' in shot ? `color=c=${shot.color}:s=${size}:r=${RATE}` : `testsrc2=s=${size}:r=${RATE}`;
    return `${source},trim=end_frame=${shot.frames},setpts=PTS-STARTPTS[r${n}s${index}]`;
  });
  const joined = reel.shots.map((_, index) => `[r${n}s${index}]`).join('');
  const seconds = durationOf(reel) / RATE;
  return [
    ...parts,
    `${joined}concat=n=${reel.shots.length}:v=1:a=0,format=yuv420p[v${n}]`,
    `aevalsrc='if(lt(mod(t\\,0.5)\\,0.01)\\,0.8*sin(2*PI*1000*t)\\,0)':s=48000:d=${seconds}[a${n}]`,
  ];
}

/**
 * Each reel with VideoToolbox H.264 (libopenh264 where the build has no VideoToolbox: h264-route.ts) and an AAC click track (what a downloaded reel looks like), all in one FFmpeg
 * run with an output per reel. (A run per reel was four process starts, which on a busy machine took seconds each.
 * UX2 round 2.)
 */
async function encodeReels(ffmpeg: string, mediaDir: string): Promise<void> {
  const { encoder } = await h264Route(ffmpeg);
  await runFfmpeg(ffmpeg, [
    ...['-y', '-hide_banner', '-loglevel', 'error'],
    ...['-filter_complex', REELS.flatMap(reelGraph).join(';')],
    ...REELS.flatMap((reel, n) => [
      ...['-map', `[v${n}]`, '-map', `[a${n}]`],
      ...['-c:v', encoder, '-b:v', '4M', '-c:a', 'aac', '-ar', '48000'],
      join(mediaDir, `${reel.id}.mp4`),
    ]),
  ]);
}

export async function buildBreakdownFixture(outDir: string): Promise<void> {
  const bins = bundledFfmpeg();
  if (bins === undefined) throw new Error('ffmpeg is not available');
  const mediaDir = join(outDir, 'media');
  mkdirSync(mediaDir, { recursive: true });
  for (const reel of BREAKDOWN_FIXTURE_REELS)
    writeJson(join(outDir, `${reel.reelId}.json`), {
      ...reel,
      source: { ...reel.source, uri: `media/${reel.reelId}.mp4` },
    });
  await encodeReels(bins.ffmpeg, mediaDir);
}
