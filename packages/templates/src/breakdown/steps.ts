// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The breakdown's heavier steps over the injected analysers: cuts by two
 * methods, on-screen text with refined edges, and the frames the Analyst and
 * the contact sheet need. Each returns a Result; run-breakdown.ts sequences
 * them and reports progress.
 */
import { join, relative } from 'node:path';
import { FrameRate, ok, type AsyncResult, type Canvas, type TextOverlay } from '@taalcut/core';
import type { BreakdownConfig } from './config';
import { sheetLayout, tileFrames } from './contact-sheet';
import {
  contextDistance,
  contextFrames,
  cosineDistance,
  judgeProposal,
  locateChanges,
  proposeCuts,
  scanFrames,
  softCut,
  softWindows,
  type CutFinding,
} from './cut-merge';
import type { BreakdownAnalysers, OcrLine } from './ports';
import { driftSpan, isDrift } from './one-shot';
import { overlayFromTrack } from './text-overlay';
import type { TextEvidence } from './text-scene';
import { blockAround, dropChrome, matchesTrack, refineEdge, trackText, type TextTrack } from './text-track';

export interface StepContext {
  readonly path: string;
  readonly dir: string;
  readonly rate: FrameRate;
  readonly total: number;
  readonly analysers: BreakdownAnalysers;
  readonly config: BreakdownConfig;
  readonly signal: AbortSignal;
}

const unique = (frames: Iterable<number>) => [...new Set(frames)].sort((a, b) => a - b);

/** Method A everywhere, method B around every proposal and on a scan, soft cuts from the scan. */
export async function findCuts(ctx: StepContext): AsyncResult<{
  findings: CutFinding[];
  scores: readonly number[];
  /** The frames embedded, for measuring how far each shot travels (BRK1 moves). */
  vectors: ReadonlyMap<number, Float32Array>;
}> {
  const { path, rate, total, config, signal } = ctx;
  const { vision } = ctx.analysers;
  const scores = await vision.sceneScores(path, { rate, signal });
  if (!scores.ok) return scores;
  const proposals = proposeCuts(scores.value, config);
  const scan = scanFrames(total, FrameRate.toNumber(rate), config.embed.scanFps);
  const vectors = new Map<number, Float32Array>();
  const embed = async (frames: readonly number[]) => {
    const wanted = frames.filter((frame) => frame >= 0 && frame < total && !vectors.has(frame));
    if (wanted.length === 0) return ok(undefined);
    const got = await vision.frameEmbeddings(path, wanted, { rate, signal });
    if (!got.ok) return got;
    wanted.forEach((frame, index) => {
      const vector = got.value[index];
      if (vector) vectors.set(frame, vector);
    });
    return ok(undefined);
  };
  const first = await embed(
    unique([...proposals.flatMap((p) => contextFrames(p, total, config.embed.context)), ...scan]),
  );
  if (!first.ok) return first;
  const vectorAt = (frame: number) => vectors.get(frame);
  const findings: CutFinding[] = [];
  for (const proposal of proposals) {
    const distance = contextDistance(vectorAt, proposal, total, config.embed.context);
    const finding = judgeProposal(proposal, scores.value[proposal]!, distance, config);
    if (finding) findings.push(finding);
  }
  const windows = softWindows(scan, vectorAt, config);
  const second = await embed(
    unique(windows.flatMap(([start, end]) => Array.from({ length: end - start + 1 }, (_, i) => start + i))),
  );
  if (!second.ok) return second;
  const located = windows.flatMap((window) => locateChanges(window, vectorAt, total, config));
  // BRK1: a ramp the shot moves as fast around is one shot drifting, not a cut (one-shot.ts).
  const bounds = [0, ...findings.filter((f) => f.status === 'confirmed').map((f) => f.frame), total];
  const spans = located.map((change) => (change.hard ? null : driftSpan(change, bounds, config)));
  const third = await embed(unique(spans.flatMap((span) => (span ? [span.before, span.after] : []))));
  if (!third.ok) return third;
  const distance = (a: number, b: number) => {
    const va = vectorAt(a);
    const vb = vectorAt(b);
    return va && vb ? cosineDistance(va, vb) : null;
  };
  const changes = located.filter((_, i) => !spans[i] || !isDrift(spans[i], distance, scores.value, config));
  // A jump A proposed was judged already (kept, disputed or dropped as a flash); a ramp near a cut is that cut.
  for (const change of changes.filter((c) => c.hard))
    if (![...proposals, ...findings.map((f) => f.frame)].some((frame) => Math.abs(frame - change.frame) <= 1))
      findings.push(softCut(change, config));
  for (const change of changes.filter((c) => !c.hard))
    if (!findings.some((finding) => Math.abs(finding.frame - change.frame) <= config.embed.context))
      findings.push(softCut(change, config));
  return ok({ findings: findings.sort((a, b) => a.frame - b.frame), scores: scores.value, vectors });
}

/** OCR samples → tracks → overlays with frame-exact edges when single-frame OCR is available. */
export async function readText(
  ctx: StepContext,
  options: { readonly screenRecording: boolean; readonly newId: () => TextOverlay['id'] },
): AsyncResult<{ overlays: TextOverlay[]; evidence: TextEvidence[]; warnings: string[] }> {
  const { path, rate, total, config, signal, dir } = ctx;
  const { vision, media } = ctx.analysers;
  if (!vision.ocrFrames) return ok({ overlays: [], evidence: [], warnings: ['ocr_unavailable'] });
  const pages = await vision.ocrFrames(path, {
    rate,
    fps: config.text.ocrFps,
    languages: config.text.languages,
    signal,
  });
  if (!pages.ok) return pages;
  let tracks = trackText(pages.value, config.text);
  if (options.screenRecording) tracks = dropChrome(tracks, pages.value.length, config.text);

  const cache = new Map<number, readonly OcrLine[]>();
  const ocrImage = vision.ocrImage;
  const linesAt = async (frame: number): Promise<readonly OcrLine[]> => {
    const cached = cache.get(frame);
    if (cached || !ocrImage) return cached ?? [];
    const images = await media.extractFrames(path, [frame], {
      rate,
      maxDimension: 1280,
      outDir: join(dir, 'ocr'),
      signal,
    });
    const lines =
      images.ok && images.value[0]
        ? await ocrImage(images.value[0], { languages: config.text.languages, signal })
        : null;
    const value = lines?.ok ? lines.value : [];
    cache.set(frame, value);
    return value;
  };

  const overlays: TextOverlay[] = [];
  // BRK1: what each overlay's samples showed, for judging it overlay or scene (text-scene.ts).
  const evidence: TextEvidence[] = [];
  const firstSample = pages.value[0]?.frame ?? 0;
  for (const track of tracks) {
    const edges = await edgesOf(track, { total, firstSample, refine: Boolean(ocrImage), linesAt, config });
    if (!edges) continue;
    overlays.push(overlayFromTrack(track, { ...edges, rate }, options.newId()));
    evidence.push({
      samples: track.samples,
      drift: track.drift,
      // FIX-SIGN: its quad and the signage round it (text-scene.ts).
      ...(track.quad ? { quad: track.quad } : {}),
      block: blockAround(track, pages.value),
    });
  }
  return ok({ overlays, evidence, warnings: ocrImage ? [] : ['ocr_edges_estimated'] });
}

async function edgesOf(
  track: TextTrack,
  options: {
    total: number;
    firstSample: number;
    refine: boolean;
    linesAt: (frame: number) => Promise<readonly OcrLine[]>;
    config: BreakdownConfig;
  },
): Promise<{ start: number; end: number } | null> {
  const { total, refine, config } = options;
  const present = async (frame: number) => matchesTrack(track, await options.linesAt(frame), config.text);
  const absent = async (frame: number) => !(await present(frame));
  if (!refine) {
    // Without the second method a one-sample line is noise; edges are halfway to the neighbouring samples.
    if (track.samples < 2) return null;
    const start =
      track.before === null
        ? track.first === options.firstSample
          ? 0
          : track.first
        : Math.round((track.before + track.first) / 2);
    const end = track.after === null ? total : Math.round((track.last + track.after) / 2);
    return { start, end: Math.max(start + 1, end) };
  }
  const start =
    track.before === null
      ? track.first === options.firstSample
        ? 0
        : track.first
      : await refineEdge(track.before, track.first, present);
  const end = track.after === null ? total : await refineEdge(track.last, track.after, absent);
  // One sample: kept only if the refinement saw it on another frame too.
  if (track.samples < 2 && end - start <= 1 && !(await present(Math.min(total - 1, track.first + 1))))
    return null;
  return { start, end: Math.max(start + 1, end) };
}

export interface FramesResult {
  readonly slotFrames: { start: number; end: number; frames: string[]; strip?: string }[];
  readonly disputeFrames: Map<number, { before: string; after: string }>;
  readonly sheet: {
    path: string;
    bytes: number;
    columns: number;
    rows: number;
    tile: { width: number; height: number };
    frames: number[];
  } | null;
}

/** 512 px working frames for the Analyst (slots and disputes) and the kept 180 px contact sheet. */
export async function makeFrames(
  ctx: StepContext,
  input: {
    readonly shots: readonly { start: number; end: number }[];
    readonly disputes: readonly number[];
    readonly canvas: Canvas;
  },
): AsyncResult<FramesResult> {
  const { path, dir, rate, total, config, signal } = ctx;
  const { media } = ctx.analysers;
  const many = input.shots.length > 100;
  const perShot = input.shots.map((shot) => {
    const middle = Math.floor((shot.start + shot.end - 1) / 2);
    return many ? [middle] : unique([shot.start, middle, shot.end - 1]);
  });
  const disputeFrames = input.disputes.flatMap((frame) => [
    Math.max(0, frame - 1),
    Math.min(total - 1, frame),
  ]);
  const wanted = unique([...perShot.flat(), ...disputeFrames]);
  const extracted = await media.extractFrames(path, wanted, {
    rate,
    maxDimension: config.contactSheet.workingFrame,
    outDir: join(dir, 'frames'),
    signal,
  });
  if (!extracted.ok) return extracted;
  const absAt = new Map(wanted.map((frame, index) => [frame, extracted.value[index]!]));
  const at = new Map(wanted.map((frame, index) => [frame, relative(dir, extracted.value[index]!)]));
  const strips = many ? [] : await shotStrips(ctx, input.shots, perShot, absAt, input.canvas);
  const slotFrames = input.shots.map((shot, index) => ({
    start: shot.start,
    end: shot.end,
    frames: perShot[index]!.map((frame) => at.get(frame)!),
    ...(strips[index] ? { strip: relative(dir, strips[index]) } : {}),
  }));
  const disputes = new Map(
    input.disputes.map((frame) => [
      frame,
      { before: at.get(Math.max(0, frame - 1))!, after: at.get(Math.min(total - 1, frame))! },
    ]),
  );

  const tiles = tileFrames(input.shots, config.contactSheet.maxTiles);
  const layout = sheetLayout(tiles.length, input.canvas, config.contactSheet);
  const reused = tiles.map((frame) => absAt.get(frame));
  let tilePaths: readonly string[];
  if (reused.every((item): item is string => item !== undefined)) {
    tilePaths = reused;
  } else {
    const tileImages = await media.extractFrames(path, tiles, {
      rate,
      maxDimension: Math.max(layout.tileWidth, layout.tileHeight),
      outDir: join(dir, 'tiles'),
      signal,
    });
    if (!tileImages.ok) return tileImages;
    tilePaths = tileImages.value;
  }
  const sheet = await media.contactSheet(
    tilePaths,
    { ...layout, quality: config.contactSheet.quality },
    { outPath: join(dir, 'contact-sheet.jpg'), signal },
  );
  if (!sheet.ok) return sheet;
  return ok({
    slotFrames,
    disputeFrames: disputes,
    sheet: {
      path: relative(dir, sheet.value.path),
      bytes: sheet.value.bytes,
      columns: layout.columns,
      rows: layout.rows,
      tile: { width: layout.tileWidth, height: layout.tileHeight },
      frames: tiles,
    },
  });
}

/**
 * BRK1: each shot's first and last frame in one image (side by side for a portrait reel, one above the other for a
 * landscape one), so the Analyst sees from one look how the subject and the camera move. Optional: a shot whose
 * strip fails keeps its frames.
 */
async function shotStrips(
  ctx: StepContext,
  shots: readonly { start: number; end: number }[],
  perShot: readonly number[][],
  absAt: ReadonlyMap<number, string>,
  canvas: Canvas,
): Promise<(string | undefined)[]> {
  const { media } = ctx.analysers;
  const long = ctx.config.contactSheet.workingFrame;
  const landscape = canvas.width >= canvas.height;
  const tileWidth = landscape ? long : Math.round((long * canvas.width) / canvas.height);
  const tileHeight = landscape ? Math.round((long * canvas.height) / canvas.width) : long;
  const strips: (string | undefined)[] = [];
  for (const [index, shot] of shots.entries()) {
    const frames = perShot[index]!;
    const ends = [absAt.get(frames[0]!), absAt.get(frames[frames.length - 1]!)];
    if (frames.length < 2 || ends.some((path) => path === undefined)) {
      strips.push(undefined);
      continue;
    }
    const made = await media.contactSheet(
      ends as string[],
      {
        columns: landscape ? 1 : 2,
        rows: landscape ? 2 : 1,
        tileWidth,
        tileHeight,
        quality: ctx.config.contactSheet.quality,
      },
      {
        outPath: join(ctx.dir, 'strips', `strip-${String(shot.start).padStart(6, '0')}.jpg`),
        signal: ctx.signal,
      },
    );
    strips.push(made.ok ? made.value.path : undefined);
  }
  return strips;
}
