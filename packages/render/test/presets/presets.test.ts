// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The landscape presets (P3-V2 "and back", SPEC P3.11): 16:9 at 1920×1080 and 4:3 at 1440×1080 are built and
 * offered, their H.264 settings reach FFmpeg, their safe rect is the 5 % title-safe inset, and a portrait
 * timeline's text boxes and captions land inside it.
 */
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FrameRate, ok, RationalTime, type ExportPresetId, type Rect } from '@taalcut/core';
import type { MediaContext, ProcessOutput, ProcessRunner } from '@taalcut/media';
import { compileComposition } from '../../src/compile/composition';
import { finishRender } from '../../src/engine/finish';
import { planForPreset } from '../../src/plan/canvas';
import {
  BUILT_PRESET_IDS,
  builtPresetIdSchema,
  EXPORT_PRESETS,
  isPortraitPreset,
  presetAvailability,
  presetFor,
  videoBitrateKbps,
} from '../../src/presets/presets.v1';
import { captionTrackOf, makeTimeline } from '../support/timeline';
import { knownEncoders } from '../support/host-video';

const LANDSCAPE_IDS = ['landscape', 'standard'] as const satisfies readonly ExportPresetId[];
const SAFE: Record<(typeof LANDSCAPE_IDS)[number], Rect> = {
  landscape: { x: 96, y: 54, width: 1728, height: 972 },
  standard: { x: 72, y: 54, width: 1296, height: 972 },
};

const inside = (box: Rect, safe: Rect) =>
  box.x >= safe.x &&
  box.y >= safe.y &&
  box.x + box.width <= safe.x + safe.width &&
  box.y + box.height <= safe.y + safe.height;

/** Records every FFmpeg run; a successful one writes its output file (the last argument). */
function recordingContext() {
  const runs: (readonly string[])[] = [];
  const output = (): ProcessOutput => ({
    exitCode: 0,
    signal: null,
    stdout: Buffer.alloc(0),
    stderrTail: '',
    durationMs: 1,
  });
  const runner: ProcessRunner = async (_command, args) => {
    runs.push(args);
    const out = args[args.length - 1];
    if (out) await writeFile(out, 'encoded');
    return ok(output());
  };
  const ctx: MediaContext = {
    binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'sidecar' },
    runner,
    platform: 'darwin',
    encoders: knownEncoders({ h264: 'h264_videotoolbox', hevc: 'hevc_videotoolbox' }),
  };
  return { runs, ctx };
}

describe('landscape presets (P3-V2, SPEC P3.11)', () => {
  it('are built and offered with the portrait ones', () => {
    for (const id of LANDSCAPE_IDS) {
      expect(BUILT_PRESET_IDS).toContain(id);
      expect(builtPresetIdSchema.safeParse(id).success).toBe(true);
    }
    expect(BUILT_PRESET_IDS).toEqual(EXPORT_PRESETS.map((preset) => preset.id));
    expect(EXPORT_PRESETS.filter(isPortraitPreset).map((preset) => preset.id)).not.toContain('landscape');
  });

  it.each(LANDSCAPE_IDS)(
    '%s: H.264 High, the device audio and loudness, 1–600 s, a title-safe rect',
    (id) => {
      const preset = presetFor(id);
      expect(preset).toMatchObject({
        width: id === 'landscape' ? 1920 : 1440,
        height: 1080,
        platform: null,
        video: { codec: 'h264', bitrateKbps: 8_000, bitrateKbpsHighRate: 12_000 },
        audio: presetFor('device').audio,
        loudness: presetFor('device').loudness,
        duration: { minSeconds: 1, maxSeconds: 600 },
        overlays: [],
        safeZoneCheckedOn: null,
        captionAnchorY: 0.85,
      });
      expect(preset.safe).toEqual(SAFE[id]);
      expect(videoBitrateKbps(preset, FrameRate.of(30))).toBe(8_000);
      expect(videoBitrateKbps(preset, FrameRate.of(60))).toBe(12_000);
      expect(presetAvailability(preset, FrameRate.of(30), 30 * 600).available).toBe(true);
      expect(presetAvailability(preset, FrameRate.of(30), 30 * 601).available).toBe(false);
    },
  );

  it.each(LANDSCAPE_IDS)('%s: its encode settings reach FFmpeg', async (id) => {
    const { runs, ctx } = recordingContext();
    const out = join(tmpdir(), `taalcut-preset-${id}-${process.pid}.mp4`);
    const finished = await finishRender({
      video: join(tmpdir(), 'picture.mp4'),
      audio: join(tmpdir(), 'mix.m4a'),
      out,
      preset: presetFor(id),
      rate: FrameRate.of(30),
      ctx,
      reencode: true,
    });
    if (!finished.ok) throw new Error(finished.error.code);
    expect(finished.value.video).toBe('h264_videotoolbox');
    const encode = runs[0]?.join(' ') ?? '';
    // media's VideoToolbox export flags (hw-video/rows/videotoolbox.ts).
    expect(encode).toContain(
      '-c:v h264_videotoolbox -b:v 8000000 -maxrate 12000000 -bufsize 16000000 -bf 0 -g 30',
    );
    expect(encode).toContain('-pix_fmt yuv420p');
    expect(encode).toContain('-profile:v high');
    expect(encode).toContain('-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv');
    // The frames carry the colour too: FFmpeg takes primaries and transfer from them (IX-F2).
    expect(encode).toContain('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv');
    const mux = runs[1]?.join(' ') ?? '';
    expect(mux).toContain('-bsf:v h264_metadata=colour_primaries=1');
    expect(mux).toContain('-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv');
    expect(mux.endsWith(out)).toBe(true);
  });

  it.each(LANDSCAPE_IDS)('%s: a portrait timeline’s text and captions land inside the safe rect', (id) => {
    const preset = presetFor(id);
    const rate = FrameRate.of(30);
    const timeline = makeTimeline({
      rate,
      items: [{ frames: 90, kind: 'image' }],
      texts: [{ start: 0, frames: 90, text: 'A title across the top' }],
      captions: captionTrackOf(rate, [
        [0, 40, 'Captions on a wide frame'],
        [45, 40, 'sit at the lower anchor'],
      ]),
    });
    const plan = planForPreset(timeline, preset);
    if (!plan.ok) throw new Error(plan.error.code);
    expect(plan.value).toMatchObject({ width: preset.width, height: preset.height });
    for (const text of plan.value.texts) {
      const box = {
        x: text.box.x * preset.width,
        y: text.box.y * preset.height,
        width: text.box.width * preset.width,
        height: text.box.height * preset.height,
      };
      expect(inside(box, preset.safe), JSON.stringify(box)).toBe(true);
    }
    const compiled = compileComposition(timeline, {
      variant: 'export',
      preset,
      burnCaptions: true,
      media: () => ({
        file: '/media/still.jpg',
        key: 'still',
        mediaStart: RationalTime.zero(rate),
        ext: 'jpg',
      }),
    });
    if (!compiled.ok) throw new Error(compiled.error.code);
    expect(compiled.value.captionBoxes).toHaveLength(2);
    for (const caption of compiled.value.captionBoxes)
      expect(inside(caption.box, preset.safe), JSON.stringify(caption.box)).toBe(true);
    expect(compiled.value.qaPlan).toMatchObject({ width: preset.width, height: preset.height });
  });
});
