// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One asset of the embed-frames bench (IX2-G1, G2, G4): `runs` rounds of today's read, the model on its frames
 * and each option asked for, interleaved so they see the same machine; then the parts of one FFmpeg run.
 */
import type * as media from '@taalcut/media';
import type { VisionEmbedder } from '../../src/embed/embedder';
import { fitLongSide, videoSourceOf, type SampledFrame } from '../../src/media/frames';
import { currentRead, runParts, windowShapes, type CurrentRead, type RunParts } from './current';
import { keyframesOnly, passWithEmbedFrames, widerWindows, type OptionRun } from './ffmpeg-options';
import {
  compareFrames,
  helperSession,
  memoryOfToday,
  type HelperRound,
  type HelperSession,
} from './helper-read';
import { modelMs } from './model';
import type { EmbedRequest } from './requests';
import { sessionProto, type SessionProtoRun } from './session-proto';
import { spread, type Spread } from './timing';

export type BenchOption = 'session' | 'helper' | 'keyframes' | 'pass' | `gap${number}`;

export interface AssetBench {
  readonly ctx: media.MediaContext;
  readonly embedder: VisionEmbedder;
  readonly runs: number;
  readonly scratch: string;
  readonly options: readonly BenchOption[];
  readonly sessionProto?: string;
  /** The mac helper binary for `helper` (IX2-G4: the product's read with the decode service on). */
  readonly helper?: string;
}

type Size = { readonly width: number; readonly height: number };

/** How a field of the rounds is summed up: its spread, its median, or its worst. */
type Reduce = 'spread' | 'median' | 'min' | 'max';
type Summary<H> = { readonly [K in keyof H]: H[K] extends 'spread' ? Spread : number };

function summariseBy<R, H extends { readonly [K in keyof R]?: Reduce }>(
  rounds: readonly R[],
  how: H,
): Summary<H> {
  const reduce = (values: number[], by: Reduce) =>
    by === 'spread'
      ? spread(values)
      : by === 'median'
        ? spread(values).median
        : by === 'min'
          ? Math.min(...values)
          : Math.max(...values);
  return Object.fromEntries(
    Object.entries(how).map(([key, by]) => [
      key,
      reduce(
        rounds.map((round) => Number(round[key as keyof R] ?? 0)),
        by as Reduce,
      ),
    ]),
  ) as Summary<H>;
}

const OPTION = { ms: 'spread', ffmpeg: 'median', frames: 'median', bytes: 'median' } as const;
const SESSION = {
  decodeMs: 'spread',
  openMs: 'spread',
  sessionMs: 'spread',
  convertMs: 'spread',
  wallMs: 'spread',
  decoded: 'median',
  identical: 'min',
  compared: 'max',
  maxDiff: 'max',
} as const;
const HELPER = {
  ms: 'spread',
  ffmpeg: 'median',
  hwaccel: 'max',
  identical: 'min',
  compared: 'max',
  maxDiff: 'max',
} as const;
const PARTS = {
  spawnMs: 'spread',
  oneFrameMs: 'spread',
  gopOneOutMs: 'spread',
  gopAllOutMs: 'spread',
} as const;

/** What the rounds gathered. */
interface Rounds {
  readonly reads: number[];
  readonly models: number[];
  readonly runMs: number[][];
  /** Today's read against itself: frames byte-identical to the first round's, per later round. */
  readonly repeatable: number[];
  readonly options: Map<string, (OptionRun & { readonly bytes?: number })[]>;
  readonly sessions: SessionProtoRun[];
  readonly helper: HelperRound[];
  first?: readonly SampledFrame[];
  frames: number;
}

/** The analysis pass without, with every statistics sample (about 10 a second), with two a second kept. */
async function passOptions(bench: AssetBench, request: EmbedRequest, size: Size, into: Rounds) {
  const video = videoSourceOf(request.path, request.plan);
  const ocr = fitLongSide(video.width, video.height, 1280);
  const fps = request.plan.frameRate.output.num / request.plan.frameRate.output.den;
  for (const [label, every] of [
    ['pass-none', undefined],
    ['pass-samples', Math.max(1, Math.round(fps / 10))],
    ['pass-2fps', Math.max(1, Math.round(fps / 2))],
  ] as const) {
    const ran = await passWithEmbedFrames(bench.ctx, request, { embed: size, ocr }, every, bench.scratch);
    into.options.set(label, [...(into.options.get(label) ?? []), ran]);
  }
}

/** One option on this round's frames. */
async function runOption(
  name: BenchOption,
  bench: AssetBench,
  round: { readonly request: EmbedRequest; readonly size: Size; readonly read: CurrentRead },
  helper: HelperSession | undefined,
  into: Rounds,
): Promise<void> {
  const { ctx, scratch } = bench;
  const { request, size, read } = round;
  if (name === 'pass') return passOptions(bench, request, size, into);
  if (name === 'helper') {
    if (helper) into.helper.push(await helper.read(read.frames));
    return;
  }
  if (name === 'session') {
    if (bench.sessionProto)
      into.sessions.push(
        await sessionProto(ctx, bench.sessionProto, { request, size, today: read.frames }, scratch),
      );
    return;
  }
  const ran =
    name === 'keyframes'
      ? await keyframesOnly(ctx, request, size, scratch)
      : await widerWindows(ctx, request, size, Number(name.slice(3)), scratch);
  into.options.set(name, [...(into.options.get(name) ?? []), ran]);
}

/** One round: today's read, the model on its frames, then every option. */
async function oneRound(
  bench: AssetBench,
  request: EmbedRequest,
  size: Size,
  helper: HelperSession | undefined,
  into: Rounds,
): Promise<void> {
  const read = await currentRead(bench.ctx, request, size, bench.scratch);
  if (into.first) into.repeatable.push(compareFrames(into.first, read.frames).identical);
  else into.first = read.frames;
  into.reads.push(read.ms);
  into.runMs.push(read.runs.filter((r) => r.command.startsWith('ffmpeg')).map((r) => Math.round(r.ms)));
  into.frames = read.frames.length;
  into.models.push(await modelMs(bench.embedder, read.frames));
  for (const name of bench.options) await runOption(name, bench, { request, size, read }, helper, into);
}

export async function benchAsset(bench: AssetBench, request: EmbedRequest, size: Size) {
  const { ctx, scratch } = bench;
  const rounds: Rounds = {
    reads: [],
    models: [],
    runMs: [],
    repeatable: [],
    options: new Map(),
    sessions: [],
    helper: [],
    frames: 0,
  };
  const helper =
    bench.helper && bench.options.includes('helper')
      ? await helperSession(ctx, bench.helper, request, size, scratch)
      : undefined;
  let helperMemory: Awaited<ReturnType<HelperSession['close']>> | undefined;
  try {
    for (let i = 0; i < bench.runs; i++) await oneRound(bench, request, size, helper, rounds);
  } finally {
    helperMemory = await helper?.close();
  }
  const ffmpegMemory = helper ? await memoryOfToday(ctx, request, size, scratch) : undefined;
  const parts: RunParts[] = [];
  for (let i = 0; i < bench.runs; i++) parts.push(await runParts(ctx, request, size, scratch));
  return {
    frames: rounds.frames,
    windows: await windowShapes(ctx, request),
    readMs: spread(rounds.reads),
    repeatable: rounds.repeatable,
    modelMs: spread(rounds.models),
    runMs: rounds.runMs,
    parts: summariseBy(parts, PARTS),
    options: Object.fromEntries([...rounds.options].map(([name, ran]) => [name, summariseBy(ran, OPTION)])),
    ...(rounds.sessions.length > 0 ? { session: summariseBy(rounds.sessions, SESSION) } : {}),
    ...(rounds.helper.length > 0
      ? { helper: { ...summariseBy(rounds.helper, HELPER), memory: helperMemory } }
      : {}),
    ...(ffmpegMemory ? { ffmpegMemory } : {}),
  };
}
