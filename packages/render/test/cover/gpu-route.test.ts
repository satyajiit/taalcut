// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import { expect, it, vi } from 'vitest';
const extractFrame = vi.hoisted(() => vi.fn());
vi.mock('@taalcut/media', async (original) => ({ ...(await original<object>()), extractFrame }));
import { extractStill } from '../../src/engine/stills';

it('cover stills use the media GPU-first extraction path with exact microsecond seeking', async () => {
  const work = await mkdtemp(join(tmpdir(), 'cover-route-'));
  try {
    const data = Buffer.from('image');
    extractFrame.mockResolvedValue(ok({ data }));
    const context = { binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'env' as const } };
    const file = join(work, 'frame.jpg');
    expect((await extractStill(context, '/original.mp4', 16.75 / 30, file)).ok).toBe(true);
    expect(extractFrame).toHaveBeenCalledWith('/original.mp4', { value: 558333, rate: 1000000 }, context, {
      format: 'jpeg',
      maxDimension: 1920,
      jpegQuality: 2,
    });
    expect(await readFile(file)).toEqual(data);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
