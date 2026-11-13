// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The OpenTimelineIO v0.18.1 subset Taalcut writes, as zod (the OTIO research
 * note's emitter contract). Stricter than the C++ reader on purpose: finite
 * numbers, rate > 0, Marker.2 colour names, Video and Audio tracks, no
 * effects. Private data lives only under `metadata.Taalcut`, a plain JSON
 * object that never contains `OTIO_SCHEMA` (the reader would decode it as an
 * object). Every export is checked against this before it is written.
 */
import { MARKER_COLOURS } from '@taalcut/core';
import { z } from 'zod';

const number = z.number().refine(Number.isFinite, { message: 'Not a finite number' });

export const otioRationalTimeSchema = z.object({
  OTIO_SCHEMA: z.literal('RationalTime.1'),
  rate: number.refine((rate) => rate > 0, { message: 'Rate must be positive' }),
  value: number,
});

export const otioTimeRangeSchema = z.object({
  OTIO_SCHEMA: z.literal('TimeRange.1'),
  duration: otioRationalTimeSchema.refine((time) => time.value >= 0, { message: 'Negative duration' }),
  start_time: otioRationalTimeSchema,
});

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    number,
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z
      .record(z.string(), jsonValue)
      .refine((object) => !('OTIO_SCHEMA' in object), { message: 'OTIO_SCHEMA inside metadata' }),
  ]),
);

export const otioMetadataSchema = z
  .object({ Taalcut: z.record(z.string(), jsonValue).optional() })
  .strict()
  .refine((metadata) => !metadata.Taalcut || !('OTIO_SCHEMA' in metadata.Taalcut), {
    message: 'OTIO_SCHEMA inside metadata.Taalcut',
  });

export const otioMarkerSchema = z.object({
  OTIO_SCHEMA: z.literal('Marker.2'),
  metadata: otioMetadataSchema,
  name: z.string().nullable(),
  color: z.enum(MARKER_COLOURS),
  marked_range: otioTimeRangeSchema,
  comment: z.string(),
});

const item = {
  metadata: otioMetadataSchema,
  name: z.string().nullable(),
  source_range: otioTimeRangeSchema.nullable(),
  effects: z.array(
    z.object({
      OTIO_SCHEMA: z.literal('FreezeFrame.1'),
      name: z.string(),
      effect_name: z.literal('FreezeFrame'),
      metadata: otioMetadataSchema,
      enabled: z.boolean(),
      time_scalar: z.literal(0),
    }),
  ),
  markers: z.array(otioMarkerSchema),
  enabled: z.boolean(),
  color: z.null(),
};

const reference = {
  metadata: otioMetadataSchema,
  name: z.string().nullable(),
  available_range: otioTimeRangeSchema.nullable(),
  available_image_bounds: z.null(),
};

export const otioExternalReferenceSchema = z.object({
  OTIO_SCHEMA: z.literal('ExternalReference.1'),
  ...reference,
  target_url: z.string().min(1),
});

export const otioMissingReferenceSchema = z.object({
  OTIO_SCHEMA: z.literal('MissingReference.1'),
  ...reference,
});

export const otioClipSchema = z
  .object({
    OTIO_SCHEMA: z.literal('Clip.2'),
    ...item,
    media_references: z.record(
      z.string().min(1),
      z.union([otioExternalReferenceSchema, otioMissingReferenceSchema]),
    ),
    active_media_reference_key: z.string().min(1),
  })
  .refine((clip) => clip.active_media_reference_key in clip.media_references, {
    message: 'active_media_reference_key is not in media_references',
    path: ['active_media_reference_key'],
  });

/** A gap needs its source_range: without one OTIO can't compute its duration. */
export const otioGapSchema = z.object({
  OTIO_SCHEMA: z.literal('Gap.1'),
  ...item,
  source_range: otioTimeRangeSchema,
});

export const otioTransitionSchema = z.object({
  OTIO_SCHEMA: z.literal('Transition.1'),
  metadata: otioMetadataSchema,
  name: z.string().nullable(),
  in_offset: otioRationalTimeSchema,
  out_offset: otioRationalTimeSchema,
  transition_type: z.enum(['SMPTE_Dissolve', 'Custom_Transition']),
});

export const otioTrackSchema = z.object({
  OTIO_SCHEMA: z.literal('Track.1'),
  ...item,
  children: z.array(z.union([otioClipSchema, otioGapSchema, otioTransitionSchema])),
  kind: z.enum(['Video', 'Audio']),
});

export const otioStackSchema = z.object({
  OTIO_SCHEMA: z.literal('Stack.1'),
  ...item,
  children: z.array(otioTrackSchema),
});

export const otioTimelineSchema = z.object({
  OTIO_SCHEMA: z.literal('Timeline.1'),
  metadata: otioMetadataSchema,
  name: z.string().nullable(),
  global_start_time: otioRationalTimeSchema.nullable(),
  tracks: otioStackSchema,
});

export type OtioTimeline = z.output<typeof otioTimelineSchema>;
export type OtioRationalTime = z.output<typeof otioRationalTimeSchema>;
export type OtioTimeRange = z.output<typeof otioTimeRangeSchema>;
export type OtioMarker = z.output<typeof otioMarkerSchema>;
export type OtioJson = Json;
