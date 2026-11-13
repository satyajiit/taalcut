// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { writeFile } from 'node:fs/promises';
import {
  err,
  NotFoundError,
  ok,
  type AsyncResult,
  type CoverImageInput,
  type CoverSettings,
} from '@taalcut/core';
import { captureFrame } from '../engine/capture-frame';
import type { RenderEngineDeps } from '../engine/deps';
import { extractStill } from '../engine/stills';

/** Resolve only the source the brief chose. Solid designs never decode timeline footage. */
export async function coverBackdrop(
  deps: RenderEngineDeps,
  request: CoverImageInput,
  cover: CoverSettings,
  image: string,
  signal?: AbortSignal,
): AsyncResult<string | null> {
  if (cover.source.kind === 'solid') return ok(null);
  if (cover.source.kind === 'frame') {
    const captured = await captureFrame(
      deps,
      {
        projectId: request.projectId,
        timelineId: request.timelineId,
        timelineRevision: request.revision,
        frame: cover.source.frame,
        source: { kind: 'preview' },
        original: true,
        maxDimension: 1920,
      },
      { signal },
    );
    if (!captured.ok) return captured;
    await writeFile(image, Buffer.from(captured.value.dataBase64, 'base64'));
    return ok(image);
  }
  const original = await deps.assets.original(cover.source.assetId);
  if (!original.ok) return original;
  if (!original.value) return err(NotFoundError({ entity: 'asset', id: cover.source.assetId }));
  const extracted = await extractStill(deps.media, original.value.path, null, image, signal);
  return extracted.ok ? ok(image) : extracted;
}
