// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * renders.mediaUrl: an app://preview URL for a render's file, its poster or
 * one of its frames, never a path. Each render and kind gets one token
 * folder (PreviewSessions.mediaFolder): the video through the folder's
 * manifest.json (the renders folder is a root main allows), posters and
 * frames as JPEGs decoded once into the folder.
 */
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  err,
  NotFoundError,
  ok,
  ValidationError,
  type AsyncResult,
  type RenderId,
  type RenderRecord,
  type RENDER_MEDIA_KINDS,
} from '@taalcut/core';
import type { RenderEngineDeps } from '../engine/deps';
import type { PreviewSessions } from '../engine/previews';
import { PREVIEW_MANIFEST } from '../engine/previews';
import { decodeFrame, finishJpeg } from '../engine/stills';
import { RenderNotReady } from '../errors';

export type RenderMediaKind = (typeof RENDER_MEDIA_KINDS)[number];

/** Long side of a poster; frames for QA details are full size. */
export const POSTER_MAX_DIMENSION = 768;

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const hasFile = (record: RenderRecord) =>
  (record.status === 'ready' || record.status === 'needsAttention') && record.filePath !== null;

/** Frame `frame` of the render as a JPEG at `out` (made once). */
async function frameJpeg(
  deps: RenderEngineDeps,
  record: RenderRecord,
  frame: number,
  out: string,
  maxDimension: number,
): AsyncResult<void> {
  if (await exists(out)) return ok(undefined);
  const scratch = await mkdtemp(join(tmpdir(), 'taalcut-poster-'));
  try {
    const png = join(scratch, 'frame.png');
    const decoded = await decodeFrame(deps.media, record.filePath!, frame, record.rate, png);
    if (!decoded.ok) return decoded;
    const jpeg = await finishJpeg(deps.media, png, {
      canvas: { width: record.width, height: record.height },
      maxDimension,
      overlay: null,
    });
    if (!jpeg.ok) return jpeg;
    await writeFile(out, jpeg.value.data);
    return ok(undefined);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function renderMediaUrl(
  deps: RenderEngineDeps,
  previews: Pick<PreviewSessions, 'mediaFolder'>,
  input: { readonly renderId: RenderId; readonly kind: RenderMediaKind; readonly frame?: number },
): AsyncResult<{ url: string }> {
  const record = await deps.store.get(input.renderId);
  if (!record.ok) return record;
  if (record.value.deletedAt !== null) return err(NotFoundError({ entity: 'render', id: input.renderId }));
  if (!hasFile(record.value)) return err(RenderNotReady({ status: record.value.status }));
  const folder = await previews.mediaFolder(`${input.renderId}:${input.kind}`);
  switch (input.kind) {
    case 'video': {
      await writeFile(
        join(folder.dir, PREVIEW_MANIFEST),
        JSON.stringify({ 'video.mp4': record.value.filePath }),
      );
      return ok({ url: folder.url('video.mp4') });
    }
    case 'poster': {
      const made = await frameJpeg(
        deps,
        record.value,
        0,
        join(folder.dir, 'poster.jpg'),
        POSTER_MAX_DIMENSION,
      );
      return made.ok ? ok({ url: folder.url('poster.jpg') }) : made;
    }
    case 'frame': {
      const frame = input.frame;
      if (frame === undefined || frame >= record.value.durationFrames)
        return err(ValidationError({ field: 'frame' }));
      const file = `frame-${frame}.jpg`;
      const made = await frameJpeg(
        deps,
        record.value,
        frame,
        join(folder.dir, file),
        Math.max(record.value.width, record.value.height),
      );
      return made.ok ? ok({ url: folder.url(file) }) : made;
    }
  }
}
