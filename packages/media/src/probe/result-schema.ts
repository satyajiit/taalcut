// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * zod schema for a ProbeResult, for when one arrives from elsewhere: a job's
 * stored output, an IPC reply. probeMedia builds ProbeResults itself and
 * doesn't need it. Objects are loose, so a newer producer's extra fields pass.
 */
import { z } from 'zod';
import type { ProbeResult } from './types';

const rational = z.object({ num: z.int(), den: z.int().positive() });
const time = z.object({ value: z.number().finite(), rate: z.number().finite().positive() });
const text = z.string().optional();
const count = z.number().optional();

const streamBase = {
  index: z.int().nonnegative(),
  codec: text,
  codecLongName: text,
  timeBase: rational.optional(),
  startTime: time.optional(),
  duration: time.optional(),
  bitRate: count,
  language: text,
  tags: z.record(z.string(), z.string()),
};

const videoStream = z.looseObject({
  ...streamBase,
  kind: z.literal('video'),
  profile: text,
  width: z.int().nonnegative(),
  height: z.int().nonnegative(),
  displayWidth: z.int().nonnegative(),
  displayHeight: z.int().nonnegative(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  pixelFormat: text,
  bitDepth: count,
  colour: z.looseObject({ range: text, space: text, transfer: text, primaries: text }),
  isHdr: z.boolean(),
  hdrFormats: z.array(z.enum(['hlg', 'pq', 'dolby_vision'])),
  dolbyVision: z
    .looseObject({
      profile: z.number(),
      level: count,
      compatibilityId: count,
      rpuPresent: z.boolean().optional(),
      enhancementLayerPresent: z.boolean().optional(),
      baseLayerPresent: z.boolean().optional(),
    })
    .optional(),
  frameRate: rational.optional(),
  averageFrameRate: rational.optional(),
  vfrHint: z.boolean(),
  frameCount: count,
  isAttachedPicture: z.boolean(),
});

const audioStream = z.looseObject({
  ...streamBase,
  kind: z.literal('audio'),
  profile: text,
  channels: count,
  channelLayout: text,
  sampleRate: count,
  sampleFormat: text,
});

const otherStream = z.looseObject({
  ...streamBase,
  kind: z.enum(['subtitle', 'data', 'attachment', 'unknown']),
});

export const probeResultSchema: z.ZodType<ProbeResult> = z.looseObject({
  path: z.string().min(1),
  container: z.looseObject({
    formatName: z.string(),
    longName: text,
    majorBrand: text,
    sizeBytes: count,
    bitRate: count,
  }),
  duration: time.optional(),
  startTime: time.optional(),
  streams: z.array(z.discriminatedUnion('kind', [videoStream, audioStream, otherStream])),
  video: videoStream.optional(),
  audio: audioStream.optional(),
  chapters: z.array(z.looseObject({ id: z.int(), start: time, end: time, title: text })),
  creationTime: text,
  phone: z
    .looseObject({
      make: text,
      model: text,
      software: text,
      creationDate: text,
      location: text,
      captureFrameRate: count,
      livePhotoId: text,
      utcOffset: text,
      modelCode: text,
      lens: text,
      focalLength35mm: z.number().positive().optional(),
      captureMode: text,
      app: text,
      appDevice: text,
    })
    .optional(),
  tags: z.record(z.string(), z.string()),
});
