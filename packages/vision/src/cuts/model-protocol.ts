// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Messages between the jobs process and the shot-boundary model's own process (IX2-S2; the eval's thread too),
 * checked on arrival: the client stops using a model that sends anything else, and the model ignores anything
 * else. The client opens the model by its folder, sends windows one message each, and releases it before an
 * idle exit; the model answers each window by its id, in the order it runs them.
 */
import { computeBackendSchema, computeFallbackEventSchema, taalcutErrorSchema } from '@taalcut/core';
import { z } from 'zod';

const floats = z.custom<Float32Array>((value) => value instanceof Float32Array, 'expected a Float32Array');
const id = z.int().nonnegative();

export const toModelSchema = z.discriminatedUnion('type', [
  /**
   * Open TransNetV2 from its component folder; the first message, once. The jobs process's probe says where
   * (`shotModelRuntime`); without it the model's process takes its platform's row.
   */
  z.object({
    type: z.literal('open'),
    modelDir: z.string().min(1),
    devices: z.array(computeBackendSchema).max(8).optional(),
    cudaDeviceId: z.int().nonnegative().optional(),
    disableGpu: z.boolean().optional(),
  }),
  /** One window of 100 frames, floats 0–255. */
  z.object({ type: z.literal('predict'), id, window: floats }),
  /** Close the session and end: the client's idle exit. */
  z.object({ type: z.literal('release') }),
]);
export type ToModel = z.infer<typeof toModelSchema>;

export const fromModelSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), model: z.string().min(1), backend: computeBackendSchema }),
  z.object({ type: z.literal('failed'), error: taalcutErrorSchema }),
  /** The model's ONNX runtime chose the CPU: the jobs process puts it on the bus. */
  z.object({ type: z.literal('fallback'), event: computeFallbackEventSchema }),
  z.object({ type: z.literal('output'), id, single: floats, manyHot: floats }),
  z.object({ type: z.literal('error'), id, error: taalcutErrorSchema }),
  z.object({ type: z.literal('released') }),
]);
export type FromModel = z.infer<typeof fromModelSchema>;
