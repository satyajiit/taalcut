// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What QA measures besides the file (docs/qa-gate.md, "DOM probe" and
 * "Contrast"): the text boxes Chrome lays out at chosen frames, and the
 * picture's colour under a box with the text left out.
 *
 * The pinned shell has no H.264 decoder, so the probe runs on a copy of the
 * composition whose every visual is a black still: text layout doesn't
 * depend on the picture, and nothing waits on a video that can't load. The
 * colour comes from the conformed segments, which carry the picture without
 * any text.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, RationalTime, type AsyncResult, type Rect, type Timeline } from '@taalcut/core';
import { runFfmpeg, runProcess, type MediaContext } from '@taalcut/media';
import { compileComposition, type CompileOptions } from '../compile/composition';
import { CaptureFailed } from '../errors';
import type { RenderPlan } from '../plan/types';
import type { ProbedTextBox, ProbedVisual } from '../types';
import { writeBundle } from './bundle-writer';
import { layoutColourRegions } from './layout-colour';
import { openCaptureSession, type CaptureHandle } from './capture';
import type { ConformedSegment } from './conform';

export interface TextProbeInput {
  readonly timeline: Timeline;
  readonly options: Omit<CompileOptions, 'media' | 'variant'>;
  /** Where the probe bundle is written. */
  readonly dir: string;
  readonly ctx: MediaContext;
  readonly chromePath: string;
  readonly browserGpu: 'hardware' | 'software';
}

export interface TextProbe {
  probe(frames: readonly number[]): Promise<readonly ProbedTextBox[]>;
  /** P3-V2: the text boxes and every visual's applied crop at each frame. */
  probeFrame(frames: readonly number[]): Promise<{ boxes: ProbedTextBox[]; visuals: ProbedVisual[] }>;
  close(): Promise<void>;
}

/** A 16×16 black JPEG every visual of the probe bundle shows. */
async function blackStill(dir: string, ctx: MediaContext): AsyncResult<string> {
  const file = join(dir, 'black.jpg');
  const run = await runFfmpeg(
    ctx,
    ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=16x16', '-frames:v', '1', file],
    {
      holdsVideoSession: false,
      timeoutMs: 30_000,
    },
  );
  return run.ok ? ok(file) : err(CaptureFailed(undefined, { detail: run.error.code }));
}

export async function openTextProbe(input: TextProbeInput): AsyncResult<TextProbe> {
  await mkdir(input.dir, { recursive: true });
  const still = await blackStill(input.dir, input.ctx);
  if (!still.ok) return still;
  const rate = input.timeline.canvas.rate;
  const compiled = compileComposition(input.timeline, {
    ...input.options,
    variant: 'export',
    media: () => ({ file: still.value, key: 'black', mediaStart: RationalTime.zero(rate), ext: 'jpg' }),
  });
  if (!compiled.ok) return compiled;
  const bundleDir = join(input.dir, 'bundle');
  await writeBundle(compiled.value, bundleDir);
  const session = await openCaptureSession({
    dir: bundleDir,
    rate,
    width: input.options.preset.width,
    height: input.options.preset.height,
    chromePath: input.chromePath,
    browserGpu: input.browserGpu,
    binaries: input.ctx.binaries,
  });
  if (!session.ok) return session;
  const handle: CaptureHandle = session.value;
  /** Text boxes and every visual's applied crop at each frame, in frame order. */
  const probeFrame = async (frames: readonly number[]) => {
    const boxes: ProbedTextBox[] = [];
    const visuals: ProbedVisual[] = [];
    for (const frame of [...new Set(frames)].sort((a, b) => a - b)) {
      const probed = await handle.probeFrame(frame);
      // A frame the probe can't read fails the checks that needed it (runQa treats a throw as unmeasured).
      if (!probed.ok) throw new Error(`${probed.error.code}: ${probed.error.detail ?? ''}`);
      boxes.push(...probed.value.boxes);
      visuals.push(...probed.value.visuals);
    }
    return { boxes, visuals };
  };
  return ok({
    probe: async (frames) => (await probeFrame(frames)).boxes,
    probeFrame,
    close: () => handle.close(),
  });
}

const hex = (bytes: Uint8Array) =>
  `#${[bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0].map((value) => value.toString(16).padStart(2, '0')).join('')}`;

/**
 * Mean colour of the picture under `box` at a render frame: the top visual's segment at that frame (a
 * still for images), black over a gap.
 */
export function segmentColourSampler(
  plan: RenderPlan,
  segments: ReadonlyMap<string, ConformedSegment>,
  ctx: MediaContext,
  sourceSizes?: ReadonlyMap<string, { readonly width: number; readonly height: number }>,
): (frame: number, box: Rect) => Promise<string> {
  return async (frame, box) => {
    const visual = [...plan.visuals]
      .reverse()
      .find(
        (candidate) => candidate.enabled && candidate.visible.start <= frame && frame < candidate.visible.end,
      );
    const segment = visual ? segments.get(visual.id) : undefined;
    if (!visual || !segment) return '#000000';
    const local = segment.ext === 'jpg' ? 0 : frame - visual.visible.start;
    const width = Math.max(1, Math.min(box.width, plan.width - box.x));
    const height = Math.max(1, Math.min(box.height, plan.height - box.y));
    const sample = async (area: Rect) => {
      const run = await runProcess(
        ctx.binaries.ffmpeg,
        [
          '-v',
          'error',
          '-i',
          segment.file,
          '-vf',
          `select=eq(n\\,${local}),crop=${area.width}:${area.height}:${area.x}:${area.y},scale=1:1:flags=area`,
          '-frames:v',
          '1',
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgb24',
          '-',
        ],
        // A software decode of the segment: no video session (IX3-K2).
        { holdsVideoSession: false, timeoutMs: 60_000, maxStdoutBytes: 1024 },
      );
      if (!run.ok || run.value.stdout.length < 3)
        throw new Error('Could not sample the picture under the text');
      return run.value.stdout;
    };
    if (!visual.visualLayout) return hex(await sample({ x: box.x, y: box.y, width, height }));
    const sourceSize = sourceSizes?.get(visual.id);
    if (!sourceSize) throw new Error('No source dimensions for native layout colour sampling');
    const regions = layoutColourRegions(
      visual,
      frame,
      box,
      sourceSize,
      { width: plan.width, height: plan.height },
      plan.rate,
    );
    const rgb = [0, 0, 0];
    for (const region of regions) {
      const colour = await sample(region.box);
      for (let channel = 0; channel < 3; channel++) rgb[channel]! += (colour[channel] ?? 0) * region.weight;
    }
    return hex(Uint8Array.from(rgb.map((value) => Math.round(Math.min(255, value)))));
  };
}
