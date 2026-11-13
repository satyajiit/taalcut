// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * zod schema for the parts of `ffprobe -of json -show_format -show_streams
 * -show_chapters` that Taalcut reads. Objects are loose: FFmpeg adds fields
 * between versions and that must not break probing. Numeric values that
 * ffprobe prints as strings stay strings here and are converted exactly in
 * map.ts. 'N/A' is treated as absent.
 */
import { z } from 'zod';

const absent = <T extends z.ZodType>(schema: T) =>
  z
    .union([schema, z.literal('N/A')])
    .optional()
    .transform((value) => (value === 'N/A' ? undefined : (value as z.output<T> | undefined)));

const decimal = absent(z.string().regex(/^-?\d+(\.\d+)?$/, 'expected decimal seconds'));
const digits = absent(z.string().regex(/^\d+$/, 'expected an unsigned integer string'));
const ratio = absent(z.string().regex(/^-?\d+[/:]\d+$/, 'expected a ratio like 30000/1001'));
const int = z.number().int();
const tags = z.record(z.string(), z.string()).optional();

export const sideDataSchema = z.looseObject({
  side_data_type: z.string(),
  rotation: z.number().optional(),
  displaymatrix: z.string().optional(),
  dv_profile: int.optional(),
  dv_level: int.optional(),
  rpu_present_flag: int.optional(),
  el_present_flag: int.optional(),
  bl_present_flag: int.optional(),
  dv_bl_signal_compatibility_id: int.optional(),
});

export const streamSchema = z.looseObject({
  index: int.nonnegative(),
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  codec_long_name: z.string().optional(),
  profile: z.string().optional(),
  codec_tag_string: z.string().optional(),
  width: int.nonnegative().optional(),
  height: int.nonnegative().optional(),
  pix_fmt: z.string().optional(),
  color_range: z.string().optional(),
  color_space: z.string().optional(),
  color_transfer: z.string().optional(),
  color_primaries: z.string().optional(),
  bits_per_raw_sample: digits,
  sample_fmt: z.string().optional(),
  sample_rate: digits,
  channels: int.nonnegative().optional(),
  channel_layout: z.string().optional(),
  r_frame_rate: ratio,
  avg_frame_rate: ratio,
  time_base: ratio,
  start_pts: int.optional(),
  start_time: decimal,
  duration_ts: int.optional(),
  duration: decimal,
  bit_rate: digits,
  nb_frames: digits,
  disposition: z.record(z.string(), z.number()).optional(),
  tags,
  side_data_list: z.array(sideDataSchema).optional(),
});

export const chapterSchema = z.looseObject({
  id: z.number(),
  time_base: z.string().regex(/^\d+\/\d+$/),
  start: int,
  end: int,
  tags,
});

export const formatSchema = z.looseObject({
  filename: z.string(),
  nb_streams: int.nonnegative(),
  format_name: z.string(),
  format_long_name: z.string().optional(),
  start_time: decimal,
  duration: decimal,
  size: digits,
  bit_rate: digits,
  tags,
});

export const ffprobeOutputSchema = z.looseObject({
  streams: z.array(streamSchema).default([]),
  chapters: z.array(chapterSchema).default([]),
  format: formatSchema,
});

export type FfprobeOutput = z.output<typeof ffprobeOutputSchema>;
export type FfprobeStream = z.output<typeof streamSchema>;
export type FfprobeSideData = z.output<typeof sideDataSchema>;
