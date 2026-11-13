// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `decodes` field of a stage job's output (IX-D6): what the job spawned.
 * Optional in every output schema, so outputs stored before it still parse.
 */
import { z } from 'zod';

const count = z.int().nonnegative();

export const decodeCountSchema = z.object({
  /** FFmpeg processes. */
  ffmpeg: count,
  /** ffprobe processes. */
  ffprobe: count,
  /** FFmpeg runs that decode a whole video stream (no seek, no frame or end limit). */
  fullDecodes: count,
  /** FFmpeg runs that decode part of a video stream (a seek, a frame or end limit). */
  partialDecodes: count,
  /** `fullDecodes` whose input is the asset's original file (not a proxy or a cached file). */
  originalFullDecodes: count,
});
export type DecodeCount = z.output<typeof decodeCountSchema>;

export const NO_DECODES: DecodeCount = {
  ffmpeg: 0,
  ffprobe: 0,
  fullDecodes: 0,
  partialDecodes: 0,
  originalFullDecodes: 0,
};
