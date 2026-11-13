// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Probe a clip and build the plan `extractAudio` requires. */
import { basename } from 'node:path';
import { err, type AsyncResult } from '@taalcut/core';
import { planNormalisation, probeMedia, type MediaContext, type NormalisationPlan } from '@taalcut/media';
import { NoAudio } from './errors';

export async function audioNormalisation(
  path: string,
  ctx: MediaContext,
  signal?: AbortSignal,
): AsyncResult<NormalisationPlan> {
  const probed = await probeMedia(path, ctx, signal ? { signal } : {});
  if (!probed.ok) {
    if (probed.error.code === 'media.file_not_found' || probed.error.code === 'media.unsupported_media') {
      return err(
        NoAudio({ name: basename(path) || path }, probed.error.detail ? { detail: probed.error.detail } : {}),
      );
    }
    return probed;
  }
  if (!probed.value.audio) return err(NoAudio({ name: basename(path) || path }));
  return planNormalisation(probed.value);
}
