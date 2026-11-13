// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Smart reframe through the real export (P3-V2, SPEC P3.2 and P3.16): 16:9 footage of a walking subject (a red
 * block on a known path) with its recorded subject track, exported to the 9:16 device preset. The delivered
 * frames keep the block in frame on at least 95 % of frames (measured on the decoded file, not the plan), QA's
 * subjectInFrame and cropJitter pass, and Chrome's applied crop (the DOM probe at 2 fps) matches the planned
 * crop within 1 px. 9:16 footage on the landscape preset gets the blurred pad; with no subject track the clip is
 * centre-cropped with a warning and the export still delivers.
 *
 * The walking clip stands on a backdrop of still bars, and the first test holds it to that: framed by the export's
 * planned crop, its picture moves on every frame by well over QA's frozen-frame noise. On a plain backdrop the
 * followed block sat still in the crop for 17 frames (83–100), and whether QA called that a freeze was decided by
 * VideoToolbox's noise, which changes with the machine's load (the delivered frames were the same either way).
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FrameRate,
  newId,
  ok,
  timelineSchema,
  type AssetId,
  type ClipReframe,
  type RenderRecord,
  type SubjectTrack,
  type Timeline,
} from '@taalcut/core';
import { runProcess, type MediaContext } from '@taalcut/media';
import { gatherExport } from '../../src/engine/export-inputs';
import { createProgressTracker } from '../../src/engine/progress';
import { openTextProbe } from '../../src/engine/qa-probes';
import type { StageContext } from '../../src/engine/stages/context';
import { planFraming } from '../../src/engine/stages/framing';
import type { ExportJobRef, SubjectTrackSource } from '../../src/ports-phase3';
import { probeGapPx, subjectInFrameCheck } from '../../src/qa/checks/reframe';
import { QA_THRESHOLDS } from '../../src/qa/thresholds.v1';
import { cropAt } from '../../src/reframe/crop-window';
import { probedCrop } from '../../src/reframe/keyframes';
import { testEngine, type TestEngine } from '../support/engine';
import { findTestMedia, mediaContext, patchColour, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';
import { checkStatus, exportToEnd, failing, queueRender } from '../support/export-record';
import {
  LANDSCAPE_SUBJECT,
  makeBlockClip,
  PORTRAIT_SUBJECT,
  recordedTrack,
  type BlockClipSpec,
} from './fixtures';
import { decodeLuma, framedPicture, freezeSpans } from './framed-motion';

const media = await findTestMedia('reframe');
const shell = findTestShell('reframe');
const skip = !media.binaries || !shell.path;
const RATE = FrameRate.of(30);
const AUTO: ClipReframe = { mode: 'auto', nudge: { x: 0, y: 0 }, scale: 1 };
/** The decoded frames' size for the block count: a quarter of the 1080×1920 canvas. */
const DECODE = { width: 270, height: 480 } as const;
/**
 * How far above QA's frozen-frame noise the framed walking clip must move (10 dB: 3.2 times the tolerated
 * difference), so neither the clip's own encode nor the render's can tip a stretch into a freeze. The bars give it
 * over 20 dB; the plain backdrop had none.
 */
const MOTION_MARGIN_DB = 10;

/** A timeline of one clip of `frames` from the block clip's start, with a reframe setting on it. */
function blockTimeline(
  spec: BlockClipSpec,
  assetId: AssetId,
  frames: number,
  reframe: ClipReframe | null,
): Timeline {
  const mediaFrames = spec.seconds * spec.fps;
  const timeline = makeTimeline({
    rate: RATE,
    // The block clips have no audio stream: the mix leaves them out, and QA expects the silence (path a).
    items: [{ frames, assetId, sourceStart: 0, mediaFrames, mediaRate: RATE }],
  });
  return timelineSchema.parse({
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.kind === 'video'
        ? { ...track, items: track.items.map((item) => (item.type === 'clip' ? { ...item, reframe } : item)) }
        : track,
    ),
  });
}

/** The recorded track for every asked range, counting the asks. */
function recordedTracks(track: SubjectTrack): SubjectTrackSource & { asked: number } {
  const source = {
    asked: 0,
    async get() {
      source.asked++;
      return ok(track);
    },
    track: async () => ok(track),
  };
  return source;
}

/** Red pixels (the block, 0xf03020 on 0x202830) in every decoded frame of a delivered file. */
async function blockPixels(ctx: MediaContext, path: string): Promise<number[]> {
  const result = await runProcess(
    ctx.binaries.ffmpeg,
    [
      '-v',
      'error',
      '-i',
      path,
      '-vf',
      `scale=${DECODE.width}:${DECODE.height}:flags=area`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { timeoutMs: 120_000, maxStdoutBytes: 128 * 1024 * 1024 },
  );
  if (!result.ok) throw new Error(`decode failed: ${result.error.code}`);
  const bytes = result.value.stdout;
  const frameBytes = DECODE.width * DECODE.height * 3;
  const counts: number[] = [];
  for (let start = 0; start + frameBytes <= bytes.length; start += frameBytes) {
    let red = 0;
    for (let at = start; at < start + frameBytes; at += 3)
      if ((bytes[at] ?? 0) > 150 && (bytes[at + 1] ?? 0) < 120 && (bytes[at + 2] ?? 0) < 110) red++;
    counts.push(red);
  }
  return counts;
}

/** The block's area on the decoded canvas when fully in frame (crop height = source height). */
function blockArea(spec: BlockClipSpec): number {
  const scale = (1920 / spec.height) * (DECODE.height / 1920);
  return spec.block.width * scale * spec.block.height * scale;
}

/** The export's stage context and gathered inputs, to plan its framing outside the run. */
async function exportInputs(engine: TestEngine, record: RenderRecord, workDir: string) {
  const gathered = await gatherExport(engine.deps, record);
  if (!gathered.ok) throw new Error(gathered.error.code);
  const stage: StageContext = {
    deps: engine.deps,
    record,
    workDir,
    signal: new AbortController().signal,
    tracker: createProgressTracker(() => undefined),
    fallback: () => undefined,
  };
  return { stage, inputs: gathered.value };
}

describe.skipIf(skip)('smart reframe through the export (P3-V2)', { timeout: 900_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let landscapeClip: string;
  let portraitClip: string;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('reframe-export');
    landscapeClip = await makeBlockClip(ctx, work.dir, 'walking', LANDSCAPE_SUBJECT);
    portraitClip = await makeBlockClip(ctx, work.dir, 'standing', PORTRAIT_SUBJECT);
  });
  afterAll(() => work?.dispose());

  it("frames the walking clip into a picture that moves on every frame, past QA's frozen-frame noise", async () => {
    const assetId = newId<'Asset'>();
    const engine = testEngine(join(work.dir, 'motion'), ctx, shell.path!, {
      subjectTracks: recordedTracks(recordedTrack(LANDSCAPE_SUBJECT, { assetId })),
    });
    engine.assets.set(assetId, landscapeClip);
    const frames = 150;
    const record = await queueRender(engine, blockTimeline(LANDSCAPE_SUBJECT, assetId, frames, AUTO));
    const { stage, inputs } = await exportInputs(engine, record, join(work.dir, 'motion-plan'));
    const framing = await planFraming(stage, inputs);
    const framed = framing.ok ? framing.value?.qa.clips[0]?.framing : undefined;
    if (framed?.kind !== 'crop') throw new Error('the clip was not cropped');
    // What the viewer sees, from the source clip and the export's own plan: no browser, no encoder, no clock.
    const luma = await decodeLuma(ctx, landscapeClip, { width: 480, height: 270 });
    const pictures = Array.from({ length: frames }, (_, frame) => framedPicture(luma, framed.keys, frame));
    const { noiseDb, minSeconds } = QA_THRESHOLDS.frozen;
    const minFrames = Math.round((minSeconds * RATE.num) / RATE.den);
    expect(freezeSpans(pictures, noiseDb + MOTION_MARGIN_DB, minFrames)).toEqual([]);
  });

  it('follows a walking subject into 9:16: the block stays in frame and the probe matches the plan', async () => {
    const assetId = newId<'Asset'>();
    const track = recordedTrack(LANDSCAPE_SUBJECT, { assetId });
    const tracks = recordedTracks(track);
    const engine = testEngine(join(work.dir, 'follow'), ctx, shell.path!, { subjectTracks: tracks });
    engine.assets.set(assetId, landscapeClip);
    const frames = 150;
    const timeline = blockTimeline(LANDSCAPE_SUBJECT, assetId, frames, AUTO);
    const record = await queueRender(engine, timeline);
    const stored = await exportToEnd(engine, record);
    expect(failing(stored)).toEqual([]);
    expect(stored.status).toBe('ready');
    expect(tracks.asked).toBeGreaterThan(0);
    expect(checkStatus(stored, 'subjectInFrame')).toBe('pass');
    expect(checkStatus(stored, 'cropJitter')).toBe('pass');

    // The delivered file, decoded: the block's red pixels against its full area.
    const counts = await blockPixels(ctx, stored.filePath!);
    expect(counts).toHaveLength(frames);
    const full = Math.max(...counts);
    // The block is wholly on screen somewhere, at the size the crop's scale gives it (edges blur in the encode).
    expect(full).toBeGreaterThan(0.9 * blockArea(LANDSCAPE_SUBJECT));
    const inFrame = counts.filter((count) => count >= 0.95 * full).length / counts.length;
    console.warn(`[reframe] block in frame on ${(inFrame * 100).toFixed(1)} % of ${frames} frames`);
    expect(inFrame).toBeGreaterThanOrEqual(0.95);

    // Chrome's crop at 2 fps, read back through the probe, against the planned crop.
    const { stage, inputs } = await exportInputs(engine, record, join(work.dir, 'follow-probe'));
    const framing = await planFraming(stage, inputs);
    if (!framing.ok || !framing.value) throw new Error('no framing planned');
    const clip = framing.value.qa.clips[0];
    expect(clip?.framing.kind).toBe('crop');
    if (!clip || clip.framing.kind !== 'crop') throw new Error('the clip was not cropped');
    const keys = clip.framing.keys;
    const probe = await openTextProbe({
      timeline: inputs.timeline,
      options: {
        preset: inputs.preset,
        burnCaptions: false,
        fonts: inputs.fonts,
        captionLayout: inputs.captionLayout,
        ...framing.value.compose,
      },
      dir: join(work.dir, 'follow-probe'),
      ctx,
      chromePath: shell.path!,
      browserGpu: 'hardware',
    });
    if (!probe.ok) throw new Error(probe.error.code);
    const probeFrames = Array.from({ length: frames / 15 }, (_, index) => index * 15);
    const read = await probe.value.probeFrame(probeFrames).finally(() => probe.value.close());
    const canvas = { width: inputs.plan.width, height: inputs.plan.height };
    const sourceAspect = clip.source.width / clip.source.height;
    const gaps = read.visuals
      .filter((reading) => reading.id === clip.clipId)
      .map((reading) => {
        const drawn = probedCrop(reading, { canvas, extent: clip.extent, sourceAspect });
        if (!drawn) throw new Error(`unreadable probe: ${JSON.stringify(reading)}`);
        return probeGapPx(cropAt(keys, reading.frame - clip.visible.start), drawn, canvas);
      });
    expect(gaps).toHaveLength(probeFrames.length);
    const worst = Math.max(...gaps);
    console.warn(`[reframe] probe vs plan: ${gaps.length} readings, max ${worst.toFixed(3)} px`);
    expect(worst).toBeLessThanOrEqual(1);
    const check = subjectInFrameCheck({
      clips: framing.value.qa.clips,
      canvas,
      rate: RATE,
      target: { projectId: timeline.projectId, timelineId: timeline.id },
      probed: read.visuals,
      transitions: framing.value.qa.transitions,
    });
    expect(check.status).toBe('pass');
    expect(check.findings).toEqual([]);
  });

  it('gives 9:16 footage on the landscape canvas a blurred pad', async () => {
    const assetId = newId<'Asset'>();
    const engine = testEngine(join(work.dir, 'pad'), ctx, shell.path!, {
      subjectTracks: recordedTracks(recordedTrack(PORTRAIT_SUBJECT, { assetId })),
    });
    engine.assets.set(assetId, portraitClip);
    // The timeline is 9:16 and keeps reframe null: on another canvas every clip reframes as auto.
    const timeline = blockTimeline(PORTRAIT_SUBJECT, assetId, 90, null);
    const record = await queueRender(engine, timeline, { presetId: 'landscape' });
    const { stage, inputs } = await exportInputs(engine, record, join(work.dir, 'pad-plan'));
    const framing = await planFraming(stage, inputs);
    if (!framing.ok || !framing.value) throw new Error('no framing planned');
    expect(framing.value.qa.clips.map((clip) => clip.framing.kind)).toEqual(['blurPad']);

    const stored = await exportToEnd(engine, record);
    expect(failing(stored)).toEqual([]);
    expect(stored.status).toBe('ready');
    // The sharp picture is the 9:16 frame fitted in the middle (607 px wide at x 656); the sides show its
    // blurred, dimmed copy: the background's colour at about 0.6 of its brightness, not black.
    const sharp = await patchColour(ctx, stored.filePath!, 45, { x: 700, y: 100, size: 8 });
    const pad = await patchColour(ctx, stored.filePath!, 45, { x: 200, y: 540, size: 8 });
    console.warn(`[reframe] pad ${pad.join(',')} beside the sharp picture's background ${sharp.join(',')}`);
    expect(pad.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(30);
    for (const [index, value] of pad.entries()) {
      const ratio = value / Math.max(1, sharp[index] ?? 1);
      expect(ratio).toBeGreaterThan(0.45);
      expect(ratio).toBeLessThan(0.85);
    }
  });

  it('centre-crops with a warning when there is no subject track, and still delivers', async () => {
    const assetId = newId<'Asset'>();
    const lines: string[] = [];
    const engine = testEngine(join(work.dir, 'untracked'), ctx, shell.path!, {
      log: (line) => lines.push(line),
    });
    engine.assets.set(assetId, landscapeClip);
    const timeline = blockTimeline(LANDSCAPE_SUBJECT, assetId, 60, AUTO);
    const record = await queueRender(engine, timeline);
    const { stage, inputs } = await exportInputs(engine, record, join(work.dir, 'untracked-plan'));
    const framing = await planFraming(stage, inputs);
    if (!framing.ok || !framing.value) throw new Error('no framing planned');
    const framed = framing.value.qa.clips[0]?.framing;
    expect(framed?.kind === 'crop' && framed.reason).toBe('noTrack');

    const stored = await exportToEnd(engine, record);
    expect(failing(stored)).toEqual([]);
    expect(stored.status).toBe('ready');
    expect(lines.some((line) => line.includes('no subject track, centred crop'))).toBe(true);
    // Without a subject there is nothing to measure: the check is skipped, never failed.
    expect(checkStatus(stored, 'subjectInFrame')).toBe('skipped');
  });

  it("tracks a shot with no stored track as the export job's child (round P3-3)", async () => {
    const assetId = newId<'Asset'>();
    const track = recordedTrack(LANDSCAPE_SUBJECT, { assetId });
    const asked: (ExportJobRef | undefined)[] = [];
    const tracks: SubjectTrackSource = {
      get: async () => ok(null),
      track: async (_assetId, _range, _signal, job) => {
        asked.push(job);
        return ok(track);
      },
    };
    const engine = testEngine(join(work.dir, 'child'), ctx, shell.path!, { subjectTracks: tracks });
    engine.assets.set(assetId, landscapeClip);
    const record = await queueRender(engine, blockTimeline(LANDSCAPE_SUBJECT, assetId, 60, AUTO));
    // The jobs queue runs the export as this job: the tracking job is its child, in the slot it holds.
    const jobId = newId<'Job'>();
    const { stage, inputs } = await exportInputs(engine, { ...record, jobId }, join(work.dir, 'child-plan'));
    const framing = await planFraming(stage, inputs);
    if (!framing.ok || !framing.value) throw new Error('no framing planned');
    expect(framing.value.qa.clips.map((clip) => clip.framing.kind)).toEqual(['crop']);
    expect(asked).toEqual([{ parentJobId: jobId }]);
  });
});
