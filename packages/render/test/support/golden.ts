// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Golden helpers for the gate 5 timing suite and the gate 8 caption suite:
 * the committed timing goldens (beat-grid maths only), a per-frame colour
 * code for sources, the frame-by-frame expectations of a timeline
 * (clips, gaps, stills and transition blends), click tracks and their
 * onsets and drift. Nothing here reads a render to
 * decide what a render should be.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FrameRate, RationalTime, type AssetId, type BeatMap, type Timeline } from '@taalcut/core';
import { runProcess, type MediaContext } from '@taalcut/media';
import { ffmpeg } from './media';
import { makeTimeline, type ClipSpec, type GapSpec } from './timeline';

export const GOLDEN_DIR = join(import.meta.dirname, '..', 'golden', 'fixtures');
/** Set to 1 to (re)write golden images instead of comparing against them. */
export const UPDATE_GOLDENS = process.env.TAALCUT_UPDATE_GOLDENS === '1';

export interface GoldenItem {
  readonly kind?: 'video' | 'image';
  readonly frames?: number;
  readonly gap?: number;
  readonly beat?: number;
  readonly sourceStart?: number;
  readonly transition?: {
    readonly kind: 'dissolve' | 'fade' | 'flash';
    readonly inFrames: number;
    readonly outFrames: number;
  };
}

export interface TimingGolden {
  readonly name: string;
  readonly rate: { readonly num: number; readonly den: number };
  readonly bpm: number;
  /** Every beat in milliseconds (may be fractional). */
  readonly beats: readonly number[];
  readonly items: readonly GoldenItem[];
  readonly expected: {
    readonly durationFrames: number;
    readonly cuts: readonly { readonly frame: number; readonly beat: number; readonly beatMs: number }[];
    readonly flashPeaks: readonly number[];
    readonly blackFrames: readonly number[];
  };
}

export function loadTimingGoldens(): { sourceFrames: number; goldens: TimingGolden[] } {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, 'timing', 'goldens.json'), 'utf8')) as {
    sourceFrames: number;
    goldens: TimingGolden[];
  };
}

export const rateOf = (golden: Pick<TimingGolden, 'rate'>) => FrameRate.of(golden.rate.num, golden.rate.den);

/** The nearest frame to a beat at `ms` milliseconds, exact (BigInt over ms · 1024, so 468.75 ms stays whole). */
export function nearestFrame(ms: number, rate: FrameRate): number {
  const scaled = BigInt(Math.round(ms * 1024));
  const n = scaled * BigInt(rate.num);
  const d = 1024n * 1000n * BigInt(rate.den);
  return Number((2n * n + d) / (2n * d));
}

// Source frame n has colour code(n). Multipliers chosen so frames up to 40 apart differ by ≥ 77 in RGB.
export const SOURCE_GEQ = "geq=r='mod(N*37+20,256)':g='mod(N*43+40,256)':b='mod(N*55+60,256)'";
export const codeColour = (n: number): [number, number, number] => [
  (n * 37 + 20) % 256,
  (n * 43 + 40) % 256,
  (n * 55 + 60) % 256,
];
const COLOURS = { black: [0, 0, 0], white: [255, 255, 255], magenta: [255, 0, 255] } as const;
export type FixedColour = keyof typeof COLOURS;

/** What one rendered frame should show: a mix of source frames and fixed colours (weights sum to 1). */
export type FrameExpectation = readonly {
  readonly source?: number;
  readonly colour?: FixedColour;
  readonly weight: number;
}[];

export interface GoldenAssets {
  readonly video: AssetId;
  readonly image: AssetId;
  readonly music: AssetId;
}

/** A beat map at 48 kHz (beats may fall between milliseconds). */
export function beatMapAt48k(beatsMs: readonly number[], bpm: number): BeatMap {
  const rate = FrameRate.of(48000);
  return {
    rate,
    beats: beatsMs.map((ms) => RationalTime.of(Math.round(ms * 48), rate)),
    downbeats: [],
    bpm,
    beatsPerBar: null,
    confidence: 1,
    source: 'user',
  };
}

/** The golden as a Timeline v1: video clips muted (the click track is the music, path b). */
export function goldenTimeline(golden: TimingGolden, assets: GoldenAssets, sourceFrames: number): Timeline {
  const items = golden.items.map((item): ClipSpec | GapSpec => {
    if (item.gap !== undefined) return { gap: item.gap };
    const beat = item.beat !== undefined ? { beat: { beatIndex: item.beat } } : {};
    if (item.kind === 'image') return { kind: 'image', frames: item.frames!, assetId: assets.image, ...beat };
    return {
      frames: item.frames!,
      assetId: assets.video,
      sourceStart: item.sourceStart!,
      mediaFrames: sourceFrames,
      muted: true,
      ...beat,
      ...(item.transition ? { transition: item.transition } : {}),
    };
  });
  return makeTimeline({
    rate: rateOf(golden),
    items,
    beatMap: beatMapAt48k(golden.beats, golden.bpm),
    music: {
      path: 'ownTrack',
      assetId: assets.music,
      offset: RationalTime.of(0, FrameRate.of(48000)),
      gainDb: 0,
    },
  });
}

interface Laid {
  readonly item: GoldenItem;
  readonly start: number;
  readonly end: number;
}

function layOut(items: readonly GoldenItem[]): Laid[] {
  let at = 0;
  return items.map((item) => {
    const length = item.gap ?? item.frames ?? 0;
    const laid = { item, start: at, end: at + length };
    at += length;
    return laid;
  });
}

const single = (expectation: FrameExpectation[number]): FrameExpectation => [expectation];

/** Frame k of a clip (any frame in its visible window, handles included). */
function clipAt(laid: Laid, frame: number): FrameExpectation[number] {
  if (laid.item.gap !== undefined) return { colour: 'black', weight: 1 };
  if (laid.item.kind === 'image') return { colour: 'magenta', weight: 1 };
  return { source: laid.item.sourceStart! + (frame - laid.start), weight: 1 };
}

/** Every frame's expectation, from the clip list and the effects' linear ramps (SPEC section 3). */
export function expectedFrames(golden: Pick<TimingGolden, 'items'>): FrameExpectation[] {
  const laid = layOut(golden.items);
  const total = laid.length > 0 ? laid[laid.length - 1]!.end : 0;
  const frames: FrameExpectation[] = [];
  for (const entry of laid)
    for (let k = entry.start; k < entry.end; k++) frames[k] = single(clipAt(entry, k));
  laid.forEach((incoming, index) => {
    const transition = incoming.item.transition;
    const outgoing = laid[index - 1];
    if (!transition || !outgoing) return;
    const cut = incoming.start;
    const s = cut - transition.inFrames;
    const e = cut + transition.outFrames;
    for (let k = Math.max(0, s); k < Math.min(total, e); k++) {
      const out = clipAt(outgoing, k);
      const inn = clipAt(incoming, k);
      if (transition.kind === 'dissolve') {
        const a = (k - s) / (e - s);
        frames[k] = [
          { ...out, weight: 1 - a },
          { ...inn, weight: a },
        ];
      } else if (transition.kind === 'fade') {
        // Dip to black: the outgoing fades out to the cut, the incoming fades in from it.
        const a = k < cut ? 1 - (k - s) / (cut - s) : (k - cut) / (e - cut);
        frames[k] = [
          { ...(k < cut ? out : inn), weight: a },
          { colour: 'black', weight: 1 - a },
        ];
      } else {
        // Flash: a white overlay rising to full at the cut over the outgoing, falling over the incoming.
        const b = k < cut ? (k - s) / (cut - s) : 1 - (k - cut) / (e - cut);
        frames[k] = [
          { ...(k < cut ? out : inn), weight: 1 - b },
          { colour: 'white', weight: b },
        ];
      }
    }
  });
  return frames;
}

/** The golden with cut `index` moved by `by` frames (the previous clip grows, the next shrinks). */
export function shiftCut(golden: TimingGolden, index: number, by: number): TimingGolden {
  const items = golden.items.map((item) => ({ ...item }));
  const length = (item: GoldenItem) => item.gap ?? item.frames ?? 0;
  const resize = (item: GoldenItem, frames: number): GoldenItem =>
    item.gap !== undefined ? { ...item, gap: frames } : { ...item, frames };
  items[index] = resize(items[index]!, length(items[index]!) + by);
  items[index + 1] = resize(items[index + 1]!, length(items[index + 1]!) - by);
  return { ...golden, items };
}

/** The colour a frame expectation predicts. */
export function predictedColour(expectation: FrameExpectation): [number, number, number] {
  let [r, g, b] = [0, 0, 0];
  for (const part of expectation) {
    const rgb = part.source !== undefined ? codeColour(part.source) : COLOURS[part.colour!];
    r += rgb[0] * part.weight;
    g += rgb[1] * part.weight;
    b += rgb[2] * part.weight;
  }
  return [r, g, b];
}

const distance = (a: readonly number[], b: readonly number[]) =>
  Math.sqrt(a.reduce((sum, value, index) => sum + (value - (b[index] ?? 0)) ** 2, 0));

/** Error (RGB distance) allowed between a predicted and a decoded frame: two encodes and a capture. */
export const FRAME_TOLERANCE = 24;

export interface FrameMismatch {
  readonly frame: number;
  readonly expected: [number, number, number];
  readonly got: readonly number[];
  readonly distance: number;
}

/** Frames whose decoded colour is not the predicted one (a missing frame is a mismatch). */
export function frameMismatches(
  expected: readonly FrameExpectation[],
  colours: readonly (readonly number[])[],
): FrameMismatch[] {
  const mismatches: FrameMismatch[] = [];
  const count = Math.max(expected.length, colours.length);
  for (let k = 0; k < count; k++) {
    const want = expected[k]
      ? predictedColour(expected[k]!)
      : ([-999, -999, -999] as [number, number, number]);
    const got = colours[k] ?? [999, 999, 999];
    const d = distance(want, got);
    if (d > FRAME_TOLERANCE) mismatches.push({ frame: k, expected: want, got, distance: Math.round(d) });
  }
  return mismatches;
}

/** Samples per beat at 48 kHz (the goldens use tempos where it is whole). */
export function beatSamples(bpm: number): number {
  const samples = (48000 * 60) / bpm;
  if (!Number.isInteger(samples)) throw new Error(`${bpm} BPM is not a whole number of samples`);
  return samples;
}

/** A click track: a 50 ms 1 kHz burst from phase 0 at every beat, `samples` long, float WAV. */
export async function clickTrack(
  ctx: MediaContext,
  path: string,
  bpm: number,
  samples: number,
): Promise<void> {
  const period = beatSamples(bpm);
  const expr = `if(lt(mod(n\\,${period})\\,2400)\\,0.4*sin(2*PI*1000*mod(n\\,${period})/48000)\\,0)`;
  await ffmpeg(ctx, [
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=${expr}:s=48000:c=stereo`,
    '-af',
    `atrim=end_sample=${samples}`,
    '-c:a',
    'pcm_f32le',
    path,
  ]);
}

/**
 * A file's sound as a player hears it: left channel at 48 kHz placed by its timestamps (a gap between
 * packets becomes silence, an overlap is dropped), not just its samples back to back.
 */
export async function decodeTimedPcm(ctx: MediaContext, path: string): Promise<Float32Array> {
  const result = await runProcess(
    ctx.binaries.ffmpeg,
    [
      '-v',
      'error',
      '-i',
      path,
      '-map',
      '0:a:0',
      '-af',
      'aresample=48000:async=1:min_hard_comp=0.001:first_pts=0,pan=mono|c0=c0',
      '-f',
      'f32le',
      '-',
    ],
    { timeoutMs: 120_000, maxStdoutBytes: 128 * 1024 * 1024 },
  );
  if (!result.ok) throw new Error(`decode failed: ${result.error.code}`);
  const bytes = result.value.stdout;
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/** Breaks in the audio packets' timeline: where a packet doesn't start where the previous one ended. */
export async function audioPacketGaps(
  ctx: MediaContext,
  path: string,
): Promise<{ readonly at: number; readonly gap: number }[]> {
  const result = await runProcess(
    ctx.binaries.ffprobe,
    ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'packet=pts,duration', '-of', 'csv=p=0', path],
    { timeoutMs: 60_000 },
  );
  if (!result.ok) throw new Error(`ffprobe failed: ${result.error.code}`);
  const packets = result.value.stdout
    .toString('utf8')
    .trim()
    .split('\n')
    .map((line) => line.split(',').map(Number) as [number, number]);
  const gaps: { at: number; gap: number }[] = [];
  for (let i = 1; i < packets.length; i++) {
    const [pts] = packets[i]!;
    const [prevPts, prevDuration] = packets[i - 1]!;
    if (pts !== prevPts + prevDuration)
      gaps.push({ at: prevPts + prevDuration, gap: pts - (prevPts + prevDuration) });
  }
  return gaps;
}

/** The onset of the burst nearest each expected sample: the first sample above 30 % of the burst's peak. */
export function clickOnsets(pcm: Float32Array, expected: readonly number[], halfWindow: number): number[] {
  return expected.map((at) => {
    const from = Math.max(0, at - halfWindow);
    const to = Math.min(pcm.length, at + halfWindow);
    let peak = 0;
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(pcm[i]!));
    if (peak < 1e-3) return -1;
    for (let i = from; i < to; i++) if (Math.abs(pcm[i]!) > 0.3 * peak) return i;
    return -1;
  });
}

/** Least-squares slope of `y` over `x`, times `span`: how much y moves across `span` of x. */
export function drift(points: readonly { readonly x: number; readonly y: number }[], span: number): number {
  if (points.length < 2) return 0;
  const n = points.length;
  const mx = points.reduce((sum, p) => sum + p.x, 0) / n;
  const my = points.reduce((sum, p) => sum + p.y, 0) / n;
  const sxx = points.reduce((sum, p) => sum + (p.x - mx) ** 2, 0);
  const sxy = points.reduce((sum, p) => sum + (p.x - mx) * (p.y - my), 0);
  return sxx === 0 ? 0 : (sxy / sxx) * span;
}
