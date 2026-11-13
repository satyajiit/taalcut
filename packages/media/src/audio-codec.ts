// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AAC encoder this build can actually open: AudioToolbox, else the native encoder. */
import { ok, type AsyncResult } from '@taalcut/core';
import { detectEncoders } from './encoders';
import type { MediaContext } from './ffmpeg';

export async function aacEncoder(ctx: MediaContext, signal?: AbortSignal): AsyncResult<string> {
  const found = await detectEncoders(ctx, signal ? { signal } : {});
  if (!found.ok) return found;
  const toolbox = found.value.encoders.some((encoder) => encoder.name === 'aac_at');
  return ok(toolbox ? 'aac_at' : 'aac');
}
