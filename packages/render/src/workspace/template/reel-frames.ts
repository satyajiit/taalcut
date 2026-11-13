// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 (tpl): the reel's frames for a composition brief: the whole 9:16 frame (place and size are judged against
 * it) at each overlay's moments, just before it comes on, through its entrance, held and through its exit, from the
 * template's kept reel (FFmpeg, the app's own binary), as JPEGs at most `maxDimension` high. A moment FFmpeg can't
 * read is left out. The frames stay on this Mac unless the Designer's model is the chat's, the breakdown's consent
 * path for a reference's frames.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import type { CompositionBrief } from './brief';
import type { ReelFrame } from './designer';

/** Every overlay's moments, labelled: the first entrance moment is the frame before it comes on. */
export function reelMomentsOf(brief: CompositionBrief) {
  return brief.overlays.flatMap((overlay) => [
    ...overlay.frames.entrance.map((seconds, index) => ({
      overlayId: overlay.overlayId,
      moment: index === 0 ? ('before' as const) : ('entrance' as const),
      seconds,
    })),
    ...overlay.frames.hold.map((seconds) => ({
      overlayId: overlay.overlayId,
      moment: 'hold' as const,
      seconds,
    })),
    ...overlay.frames.exit.map((seconds) => ({
      overlayId: overlay.overlayId,
      moment: 'exit' as const,
      seconds,
    })),
  ]);
}

export async function reelFrames(
  ctx: MediaContext,
  dir: string,
  reel: string,
  brief: CompositionBrief,
  maxDimension = 768,
): Promise<ReelFrame[]> {
  const work = await mkdtemp(join(dir, 'reel-frames-'));
  try {
    const frames: ReelFrame[] = [];
    for (const [index, moment] of reelMomentsOf(brief).entries()) {
      const out = join(work, `${index}.jpg`);
      const run = await runFfmpeg(
        ctx,
        [
          '-y',
          '-ss',
          moment.seconds.toFixed(3),
          '-i',
          reel,
          '-frames:v',
          '1',
          '-vf',
          `scale=-2:'min(${maxDimension},ih)'`,
          '-q:v',
          '3',
          out,
        ],
        { holdsVideoSession: false, timeoutMs: 30_000 },
      );
      if (!run.ok) continue;
      frames.push({
        ...moment,
        picture: { data: (await readFile(out)).toString('base64'), mimeType: 'image/jpeg' },
      });
    }
    return frames;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
