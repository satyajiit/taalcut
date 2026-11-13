// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The design eval's stills (HFW1 dsn): render's own `workspaceFrames` on the eval's engine (the bundled FFmpeg,
 * the pinned headless shell, the committed fonts), over a made-up moving clip standing in for every shot of the
 * video, so a live run's Designer sees real stills and real frame checks. The stand-in run draws nothing: one tiny
 * JPEG a second asked, every check passing.
 */
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ok, type AssetId, type Timeline } from '@taalcut/core';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import { createRenderEngine } from '@taalcut/render';
import { requireMediaBinaries } from '../media-bin';
import { evalEngine, evalShell } from '../render/real-engine';
import type { FramesFn } from './world';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

/** Stills that draw nothing (the stand-in run). */
export const standInFrames: FramesFn = async (input) =>
  ok({
    frames: input.seconds.map((seconds) => ({
      seconds,
      mimeType: 'image/jpeg' as const,
      dataBase64: JPEG,
      width: 432,
      height: 768,
      box: null,
    })),
    checks: [{ id: 'bounds', status: 'pass' as const }],
    ms: 1,
  });

export interface RealFrames {
  readonly frames: FramesFn;
  readonly timelines: Map<Timeline['id'], Timeline>;
  /** Every clip of `timeline` drawn from the made-up clip. */
  footage(timeline: Timeline): void;
}

/** render's workspaceFrames over `root` (the workspace's folder too), with a made-up 1080×1920 clip as footage. */
export async function realFrames(root: string): Promise<RealFrames> {
  const shell = evalShell();
  if (!shell.ok) throw new Error(`No headless shell for real stills: ${shell.error.detail ?? shell.error.code}`);
  const media: MediaContext = { binaries: await requireMediaBinaries() };
  await mkdir(join(root, 'footage'), { recursive: true });
  const clip = join(root, 'footage', 'made-up.mp4');
  const made = await runFfmpeg(media, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=1080x1920:r=30:d=16',
    '-c:v',
    // The bundled FFmpeg is LGPL: the platform's encoder, as render's tests make their clips.
    process.platform === 'darwin' ? 'h264_videotoolbox' : 'libopenh264',
    '-b:v',
    '6M',
    '-pix_fmt',
    'yuv420p',
    clip,
  ]);
  if (!made.ok) throw new Error(`The made-up clip was not made: ${made.error.detail ?? made.error.code}`);
  const engine = evalEngine(root, media, shell.value);
  const render = createRenderEngine({ ...engine.deps, workspaceRoot: root });
  return {
    timelines: engine.timelines,
    footage(timeline) {
      for (const track of timeline.tracks)
        if (track.kind === 'video')
          for (const item of track.items)
            if (item.type === 'clip' && item.media.kind === 'video') engine.assets.set(item.media.assetId as AssetId, clip);
    },
    frames: (input) =>
      render.worker.workspaceFrames
        ? render.worker.workspaceFrames(input)
        : standInFrames(input, { signal: new AbortController().signal }),
  };
}
