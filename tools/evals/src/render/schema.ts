// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { parseNamed } from '../schema';

/**
 * Render-golden document. This is not core's Timeline: the real adapter maps
 * it onto Timeline later. Clips play in order and tile the output.
 */

const idSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be lowercase words separated by hyphens');

const languageSchema = z.enum(['en', 'hi', 'es', 'pt-BR']);

const frameRateSchema = z
  .object({
    numerator: z.number().int().positive(),
    denominator: z.number().int().positive(),
  })
  .strict();

const clipSchema = z
  .object({
    clipId: z.number().int().min(0).max(255),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be #RRGGBB'),
    inFrame: z.number().int().nonnegative(),
    frames: z.number().int().positive(),
  })
  .strict();

const timedTextSchema = z
  .object({
    text: z.string().min(1),
    startFrame: z.number().int().nonnegative(),
    language: languageSchema,
  })
  .strict();

const transitionSchema = z
  .object({
    atClipIndex: z.number().int().nonnegative(),
    kind: z.enum(['dissolve', 'cut']),
    frames: z.number().int().positive(),
  })
  .strict();

export const renderGoldenSchema = z
  .object({
    id: idSchema,
    synthetic: z.boolean(),
    note: z.string().min(1),
    frameRate: frameRateSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    cellSize: z.number().int().min(2),
    clips: z.array(clipSchema).min(1),
    beats: z.array(z.number().int().nonnegative()),
    overlays: z.array(timedTextSchema),
    captions: z.array(timedTextSchema),
    transition: transitionSchema.optional(),
  })
  .strict()
  .superRefine((golden, ctx) => {
    if (golden.width !== 40 * golden.cellSize) {
      ctx.addIssue({
        code: 'custom',
        path: ['width'],
        message: `width must be 40 * cellSize (${40 * golden.cellSize})`,
      });
    }
    if (golden.height < golden.cellSize) {
      ctx.addIssue({
        code: 'custom',
        path: ['height'],
        message: 'height must cover the timing strip',
      });
    }
    const duration = golden.clips.reduce((sum, clip) => sum + clip.frames, 0);
    golden.beats.forEach((beat, index) => {
      if (beat >= duration) {
        ctx.addIssue({
          code: 'custom',
          path: ['beats', index],
          message: `beat ${beat} must be a frame inside [0, ${duration})`,
        });
      }
      const previous = golden.beats[index - 1];
      if (previous !== undefined && beat <= previous) {
        ctx.addIssue({
          code: 'custom',
          path: ['beats', index],
          message: 'beats must be strictly increasing',
        });
      }
    });
    for (const [list, label] of [
      [golden.overlays, 'overlays'],
      [golden.captions, 'captions'],
    ] as const) {
      list.forEach((item, index) => {
        if (item.startFrame >= duration) {
          ctx.addIssue({
            code: 'custom',
            path: [label, index, 'startFrame'],
            message: `${label} startFrame must be inside [0, ${duration})`,
          });
        }
      });
    }
    if (golden.transition !== undefined && golden.transition.atClipIndex >= golden.clips.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['transition', 'atClipIndex'],
        message: `atClipIndex must be inside [0, ${golden.clips.length})`,
      });
    }
  });

export type RenderGolden = z.infer<typeof renderGoldenSchema>;
export type RenderClip = z.infer<typeof clipSchema>;

export function durationFrames(golden: RenderGolden): number {
  return golden.clips.reduce((sum, clip) => sum + clip.frames, 0);
}

export function parseRenderGolden(input: unknown, label = 'render golden'): RenderGolden {
  return parseNamed(renderGoldenSchema, input, label);
}

/**
 * Move one cut: add `frames` to that clip and subtract them from the next.
 * inFrame stays put, so the source frame at the new cut is unchanged.
 */
export function applyCutShift(
  golden: RenderGolden,
  shift: { clipIndex: number; frames: number },
): RenderGolden {
  if (!Number.isInteger(shift.clipIndex) || !Number.isInteger(shift.frames)) {
    throw new Error('cutShiftFrames clipIndex and frames must be integers');
  }
  const clips = golden.clips.map((clip) => ({ ...clip }));
  const current = clips[shift.clipIndex];
  const next = clips[shift.clipIndex + 1];
  if (current === undefined || next === undefined) {
    throw new Error(`cutShiftFrames clipIndex ${shift.clipIndex} needs a following clip`);
  }
  const currentFrames = current.frames + shift.frames;
  const nextFrames = next.frames - shift.frames;
  if (currentFrames < 1 || nextFrames < 1) {
    throw new Error('cutShiftFrames leaves a clip shorter than 1 frame');
  }
  current.frames = currentFrames;
  next.frames = nextFrames;
  return { ...golden, clips };
}
