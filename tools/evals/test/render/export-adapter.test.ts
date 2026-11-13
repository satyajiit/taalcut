// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The real render adapter (P2-Q3 wiring): a small golden exported by
 * @taalcut/render's engine (headless shell, VideoToolbox, mix, QA) and read
 * back by this package's checker: every frame's source and clip, cuts on the
 * beat grid, click drift. A one-frame cut shift fails the check. Needs FFmpeg
 * and the pinned headless shell; skips with a message without them.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { exportRenderSystem } from '../../src/adapters/render';
import { testFfmpegFor } from '@taalcut/media/test-support';
import { beatSeconds, clickOnsets, driftFails, readWavPcm } from '../../src/render/audio';
import { cutsMatch } from '../../src/render/check';
import { decodeFrames } from '../../src/render/encode';
import { wavPathFor } from '../../src/render/paths';
import { evalShell } from '../../src/render/real-engine';
import { parseRenderGolden } from '../../src/render/schema';
import { readStrip } from '../../src/render/strip';
import { readFileSync } from 'node:fs';

// The run's FFmpeg, checked once before any file started (media's test-support-ffmpeg.ts).
const { binaries } = testFfmpegFor(inject('testFfmpeg'), 'render adapter');
const shell = evalShell();
const skip = !binaries || !shell.ok;
if (skip) console.warn(`render adapter: skipped (${binaries ? 'no chrome-headless-shell' : 'no FFmpeg'})`);
const dir = mkdtempSync(join(tmpdir(), 'taalcut-render-real-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const golden = parseRenderGolden({
  id: 'real-probe',
  synthetic: true,
  note: 'Synthetic plan. Media is generated at test time.',
  frameRate: { numerator: 30, denominator: 1 },
  width: 80,
  height: 24,
  cellSize: 2,
  clips: [
    { clipId: 1, color: '#e23d28', inFrame: 0, frames: 45 },
    { clipId: 2, color: '#2244aa', inFrame: 12, frames: 45 },
  ],
  beats: [0, 15, 30, 45, 60, 75],
  overlays: [{ text: 'Probe', startFrame: 0, language: 'en' }],
  captions: [{ text: 'Hello there', startFrame: 10, language: 'en' }],
});

describe.skipIf(skip)('export render adapter', { timeout: 300_000 }, () => {
  it('renders every frame where the golden puts it, on the beat, without drift; a shifted cut fails', async () => {
    const system = exportRenderSystem({
      media: { binaries: binaries! },
      shell: shell.ok ? shell.value : '',
      workDir: join(dir, 'work'),
    });
    const clean = await system.render({
      goldenId: golden.id,
      timeline: golden,
      outPath: join(dir, 'clean.mkv'),
    });
    expect(typeof clean.qaPassed).toBe('boolean');
    const frames = (await decodeFrames(binaries!.ffmpeg, clean.videoPath, golden.width, golden.height)).map(
      (rgb) => readStrip(rgb, golden.width, golden.height, golden.cellSize),
    );
    expect(frames).toHaveLength(90);
    expect(cutsMatch(golden, frames)).toEqual({ pass: true });
    const wav = readWavPcm(readFileSync(wavPathFor(clean.videoPath)));
    const onsets = clickOnsets(wav.pcm, wav.sampleRate);
    expect(onsets.length).toBe(golden.beats.length);
    expect(driftFails(onsets, beatSeconds(golden.frameRate, golden.beats))).toBe(false);

    const shifted = await system.render({
      goldenId: golden.id,
      timeline: golden,
      outPath: join(dir, 'shifted.mkv'),
      cutShiftFrames: { clipIndex: 0, frames: 1 },
    });
    const shiftedFrames = (
      await decodeFrames(binaries!.ffmpeg, shifted.videoPath, golden.width, golden.height)
    ).map((rgb) => readStrip(rgb, golden.width, golden.height, golden.cellSize));
    expect(cutsMatch(golden, shiftedFrames).pass).toBe(false);
  });
});
