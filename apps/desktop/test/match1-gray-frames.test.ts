// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1: the breakdown's `grayFrames` port as the jobs process wires it (media's raw sampler on the reel's decode
 * plan), on a reel of two moving pictures joined by a dissolve (templates' testing/moving-reel.ts). Every frame
 * comes back, in order and at the asked size, and templates' pixel finder reads the dissolve from them with the
 * shipped config. No model: the finder is arithmetic on the pixels.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FrameRate, ok } from '@taalcut/core';
import { selectWorkingEncoder, type MediaContext } from '@taalcut/media';
import { BREAKDOWN_CONFIG, findGradual } from '@taalcut/templates';
import { MOVING_REEL, movingReelArgs, runProcess } from '@taalcut/templates/test-support';
import { breakdownMedia } from '../src/utility/roots/template-analysers';
import { testFfmpeg } from './helpers/test-ffmpeg';

const resolved = await testFfmpeg('MATCH1 gray frames');
const root = mkdtempSync(join(tmpdir(), 'taalcut-desktop-gray-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe.skipIf(!resolved.ok)('the breakdown’s gray frames (MATCH1)', { timeout: 180_000 }, () => {
  it('reads every frame of a reel small and gray, and the finder reads its dissolve from them', async () => {
    if (!resolved.ok) return;
    const binaries = resolved.value;
    const encoder = await selectWorkingEncoder({ binaries }, 'h264');
    if (!encoder.ok) throw new Error(encoder.error.code);
    const reel = join(root, 'dissolve.mp4');
    const made = await runProcess(
      binaries.ffmpeg,
      movingReelArgs('dissolve', reel, { encoder: encoder.value.encoder }),
    );
    if (!made.ok) throw new Error(made.error.detail);

    const media = breakdownMedia({ media: async () => ok<MediaContext>({ binaries }), onFallback: () => {} });
    const { longSide } = BREAKDOWN_CONFIG.gradual;
    const rate = FrameRate.of(30);
    const gray = await media.grayFrames!(reel, { rate, longSide, signal: new AbortController().signal });
    if (!gray.ok) throw new Error(`${gray.error.code}: ${gray.error.detail ?? ''}`);

    // 270×480 inside 64 px: every frame of the reel, each its own copy of width × height bytes.
    expect([gray.value.width, gray.value.height]).toEqual([36, 64]);
    expect(gray.value.frames).toHaveLength(MOVING_REEL.frames);
    expect(gray.value.frames.every((frame) => frame.length === 36 * 64)).toBe(true);
    expect(new Set(gray.value.frames.map((frame) => frame.buffer)).size).toBe(MOVING_REEL.frames);

    const found = findGradual(gray.value.frames, FrameRate.toNumber(rate), BREAKDOWN_CONFIG.gradual);
    expect(found).toHaveLength(1);
    const [dissolve] = found;
    expect(dissolve!.kind).toBe('dissolve');
    // Every truly blended frame (91 to 99) is inside, with at most two clean ones taken in at either end.
    const { start, end } = MOVING_REEL.dissolve;
    expect(dissolve!.start).toBeLessThanOrEqual(start);
    expect(dissolve!.start).toBeGreaterThanOrEqual(start - 2);
    expect(dissolve!.end).toBeGreaterThanOrEqual(end);
    expect(dissolve!.end).toBeLessThanOrEqual(end + 2);
    expect(dissolve!.frame).toBeGreaterThan(start);
    expect(dissolve!.frame).toBeLessThanOrEqual(end);
  });
});
