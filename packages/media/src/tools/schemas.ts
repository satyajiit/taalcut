// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * zod schemas for media tool inputs and outputs. Strings that come from the
 * file (its name, device tags) are marked `.meta({ untrusted })`: the agent
 * wraps them as untrusted data before a model sees them (agent SPEC section 8).
 */
import { artifactRefSchema } from '@taalcut/core';
import { z } from 'zod';

/** RationalTime as tool input or output: `value / rate` seconds, exact. */
export const rationalTimeSchema = z
  .object({
    value: z.number().finite().describe('Count of 1/rate second units'),
    rate: z.number().finite().positive().describe('Units per second, e.g. 30 or 1000'),
  })
  .describe('Exact time: value / rate seconds. 2.5 s is { "value": 2500, "rate": 1000 }');

const rationalSchema = z.object({ num: z.number().int(), den: z.number().int().positive() });

export const probeInputSchema = z.object({
  path: z.string().min(1).describe('Absolute path of a video, audio or image file on this Mac'),
});
export type ProbeToolInput = z.output<typeof probeInputSchema>;

export const probeSummarySchema = z.object({
  file: z.string().meta({ untrusted: 'file-name' }).describe('File name (from the user)'),
  container: z.string().describe("FFmpeg's demuxer names, e.g. 'mov,mp4,m4a,3gp,3g2,mj2'"),
  sizeBytes: z.number().int().nonnegative().optional(),
  duration: rationalTimeSchema.optional(),
  durationSeconds: z.number().optional().describe('Duration in seconds, rounded to 1 ms, for reading only'),
  video: z
    .object({
      codec: z.string(),
      profile: z.string().optional(),
      width: z.number().int().describe('Width as displayed, after rotation'),
      height: z.number().int().describe('Height as displayed, after rotation'),
      rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
      frameRate: rationalSchema.optional().describe('Exact frame rate, e.g. 30000/1001'),
      fps: z.number().optional().describe('Frame rate rounded to 3 decimals, for reading only'),
      variableFrameRate: z.boolean(),
      hdr: z.array(z.enum(['hlg', 'pq', 'dolby_vision'])).describe('Empty for SDR'),
      bitDepth: z.number().int().optional(),
    })
    .optional(),
  audio: z
    .object({
      codec: z.string(),
      channels: z.number().int().optional(),
      sampleRate: z.number().int().optional(),
    })
    .optional(),
  streamCount: z.number().int().nonnegative(),
  creationTime: z.string().meta({ untrusted: 'metadata' }).optional(),
  device: z.string().meta({ untrusted: 'metadata' }).optional().describe('Camera or phone make and model'),
});
export type ProbeSummary = z.output<typeof probeSummarySchema>;

export const probeOutputSchema = z.object({
  summary: probeSummarySchema,
  details: artifactRefSchema
    .optional()
    .describe('The full probe result (every stream, colour data, chapters, tags) as a JSON artifact'),
});
export type ProbeToolOutput = z.output<typeof probeOutputSchema>;
