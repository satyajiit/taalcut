// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/** The synthetic eval clips really show the block where the recorded track says it is. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaContext } from '@taalcut/media';
import { findTestMedia, mediaContext, patchColour, tempDir } from '../support/media';
import {
  blockCentre,
  LANDSCAPE_SUBJECT,
  makeBlockClip,
  PORTRAIT_SUBJECT,
  type BlockClipSpec,
} from './fixtures';

const media = await findTestMedia('reframe fixtures');

describe.skipIf(!media.binaries)('reframe eval clips', { timeout: 120_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  beforeAll(async () => {
    if (!media.binaries) return;
    ctx = mediaContext(media.binaries);
    work = await tempDir('reframe-fixtures');
  });
  afterAll(async () => work?.dispose());

  const red = ([r, g, b]: [number, number, number]) => r > 180 && g < 110 && b < 110;

  it.each([
    ['landscape', LANDSCAPE_SUBJECT],
    ['portrait', PORTRAIT_SUBJECT],
  ] as [string, BlockClipSpec][])(
    '%s: the block is at its known centre and the background elsewhere',
    async (name, spec) => {
      const path = await makeBlockClip(ctx, work.dir, name, spec);
      for (const frame of [0, Math.round(spec.fps * 1.5), Math.round(spec.fps * 3.25)]) {
        const centre = blockCentre(spec, frame / spec.fps);
        expect(
          red(
            await patchColour(ctx, path, frame, { x: Math.round(centre.x) - 2, y: Math.round(centre.y) - 2 }),
          ),
        ).toBe(true);
        const away = { x: Math.round(centre.x + spec.block.width), y: Math.round(centre.y) - 2 };
        if (away.x + 4 < spec.width) expect(red(await patchColour(ctx, path, frame, away))).toBe(false);
      }
    },
  );
});
