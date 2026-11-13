// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `images.generateForSlot`'s input and output as the model and the registry see them, and its idempotency
 * key: the same timeline, slot, prompt and options never pay twice. Ids are plain ULID strings (`ulidSchema`), so
 * both convert to JSON Schema for the model; the timeline store checks them again.
 */
import { createHash } from 'node:crypto';
import { ulidSchema } from '@taalcut/core';
import { z } from 'zod';
import { IMAGE_ASPECTS, MAX_IMAGE_PROMPT } from './image-types';

export const generateForSlotInput = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  slotId: ulidSchema('TemplateSlot').describe('The slot to fill, from the cast or the gaps list'),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(MAX_IMAGE_PROMPT)
    .describe(
      'What the still shows, written from the slot intent and the template look. Never a real person or their likeness.',
    ),
  aspect: z.enum(IMAGE_ASPECTS).optional().describe("Default: the timeline canvas's aspect"),
  count: z.literal([1, 2, 3, 4]).default(1).describe('Takes to make; every one is paid for'),
  avoid: z.string().trim().min(1).max(500).optional().describe('What the still must not show'),
  seed: z.int().min(0).max(2_147_483_647).optional(),
});
export type GenerateForSlotInput = z.output<typeof generateForSlotInput>;

export const generateForSlotOutput = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  slotId: ulidSchema('TemplateSlot'),
  assets: z
    .array(
      z.object({
        assetId: ulidSchema('Asset'),
        width: z.int().positive(),
        height: z.int().positive(),
        provider: z.string().min(1).max(64),
        model: z.string().min(1).max(128),
        thumbnailArtifactId: z.string().min(1),
      }),
    )
    .min(1)
    .max(4),
  /** The take now in the slot; null when the slot keeps its clip. */
  placed: ulidSchema('Asset').nullable(),
  /** Why nothing was placed: the slot holds a clip (swap it in with timeline.swapClip) or a locked clip. */
  notPlaced: z.enum(['clip', 'lockedClip']).optional(),
  costUsd: z.number().nonnegative(),
  fallbacks: z
    .array(z.object({ from: z.string(), to: z.string(), reason: z.string() }))
    .max(8)
    .describe('Paths that failed before the one that worked'),
});
export type GenerateForSlotResult = z.input<typeof generateForSlotOutput>;
export type GenerateForSlotOutput = z.output<typeof generateForSlotOutput>;
export type KeptTake = GenerateForSlotResult['assets'][number];

export const sha256Hex = (text: string) => createHash('sha256').update(text).digest('hex');

export function generateForSlotKey(input: GenerateForSlotInput): string {
  return sha256Hex(
    JSON.stringify([
      input.timelineId,
      input.slotId,
      input.prompt,
      input.aspect ?? '',
      input.count,
      input.avoid ?? '',
      input.seed ?? '',
    ]),
  );
}
