// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CancelledError,
  ConflictError,
  err,
  NotFoundError,
  ok,
  toTaalcutError,
  ValidationError,
  VIDEO_SIZES,
  coverImageInputSchema,
  type AsyncResult,
  type CoverImage,
  type CoverImageInput,
} from '@taalcut/core';
import type { RenderEngineDeps } from '../engine/deps';
import { writeBundle } from '../engine/bundle-writer';
import { openStillSession } from '../engine/still-session';
import { canvasPreset } from '../presets/canvas-preset';
import { DEFAULT_PRESET_ID, presetFor } from '../presets/presets.v1';
import { coverBundle } from './cover-bundle';
import { coverBackdrop } from './cover-backdrop';

export async function coverImage(
  deps: RenderEngineDeps,
  input: CoverImageInput,
  options: { signal?: AbortSignal } = {},
): AsyncResult<CoverImage> {
  const parsed = coverImageInputSchema.safeParse(input);
  if (!parsed.success) return err(ValidationError({ field: 'cover' }));
  const request = parsed.data;
  if (options.signal?.aborted) return err(CancelledError());
  const found = await deps.timelines.get(request.timelineId);
  if (!found.ok) return found;
  const timeline = found.value;
  if (timeline.projectId !== request.projectId)
    return err(NotFoundError({ entity: 'timeline', id: request.timelineId }));
  if (timeline.revision !== request.revision)
    return err(ConflictError({ entity: 'timeline', id: timeline.id }));
  const cover =
    request.cover ??
    (request.aspect
      ? timeline.covers?.find((item) => item.aspect === request.aspect)
      : timeline.covers?.at(-1));
  if (!cover) return err(NotFoundError({ entity: 'cover', id: timeline.id }));
  const work = await mkdtemp(join(tmpdir(), 'taalcut-cover-'));
  try {
    const image = await coverBackdrop(deps, request, cover, join(work, 'original.jpg'), options.signal);
    if (!image.ok) return image;
    if (options.signal?.aborted) return err(CancelledError());
    const canvas = { ...VIDEO_SIZES[cover.aspect], rate: timeline.canvas.rate };
    const dir = join(work, 'bundle');
    await writeBundle(coverBundle(cover, image.value, deps.fontsDir), dir);
    const session = await openStillSession(
      deps,
      dir,
      timeline,
      canvasPreset(presetFor(DEFAULT_PRESET_ID), canvas),
    );
    if (!session.ok) return session;
    try {
      if (cover.design) {
        const fitted = await session.value.evaluateAt(
          0,
          `document.fonts.ready.then(() => !document.querySelector('[data-cover-fit="overflow"]'))`,
        );
        if (!fitted.ok) return fitted;
        if (fitted.value !== true)
          return err(
            ValidationError(
              { field: 'cover.design' },
              { detail: 'Cover text cannot fit its layer box. Enlarge the box or shorten the copy.' },
            ),
          );
      }
      const shot = await session.value.screenshot(0);
      if (!shot.ok) return shot;
      if (options.signal?.aborted) return err(CancelledError());
      return ok({
        mimeType: 'image/jpeg',
        dataBase64: shot.value.toString('base64'),
        width: canvas.width,
        height: canvas.height,
        revision: timeline.revision,
      });
    } finally {
      await session.value.close();
    }
  } catch (cause) {
    return err(toTaalcutError(cause));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
