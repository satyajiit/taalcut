// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { RationalTime, rationalTimeSchema } from '../time/rational-time';
import { canvasSchema, sha256Schema } from '../templates/template-parts';
import { workspacePathSchema } from '../workspace/workspace-files';

export const AUTHORED_PROGRAM_LIMITS = {
  sourceBytes: 1024 * 1024,
  fileBytes: 8 * 1024 * 1024,
  files: 256,
  bytes: 64 * 1024 * 1024,
} as const;
export const authoredProgramRefSchema = z.object({ id: idSchema<'AuthoredProgram'>(), hash: sha256Schema });
export type AuthoredProgramRef = z.output<typeof authoredProgramRefSchema>;
export const authoredChapterSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  start: rationalTimeSchema,
  duration: rationalTimeSchema,
});
/** One immutable source bundle. Chapters describe its single continuous clock, not separate playback clips. */
export const authoredProgramSchema = authoredProgramRefSchema
  .extend({
    version: z.int().positive(),
    entry: workspacePathSchema,
    files: z
      .array(
        z.object({
          path: workspacePathSchema,
          sha256: sha256Schema,
          bytes: z.int().nonnegative().max(AUTHORED_PROGRAM_LIMITS.fileBytes),
        }),
      )
      .min(1)
      .max(AUTHORED_PROGRAM_LIMITS.files),
    canvas: canvasSchema,
    duration: rationalTimeSchema,
    chapters: z.array(authoredChapterSchema).max(100),
    assetIds: z.array(idSchema<'Asset'>()).max(500),
  })
  .superRefine((program, ctx) => {
    if (!program.files.some((file) => file.path === program.entry))
      ctx.addIssue({ code: 'custom', path: ['entry'], message: 'The entry must be in the bundle' });
    if (new Set(program.files.map((file) => file.path)).size !== program.files.length)
      ctx.addIssue({ code: 'custom', path: ['files'], message: 'Repeated file path' });
    if (program.files.reduce((sum, file) => sum + file.bytes, 0) > AUTHORED_PROGRAM_LIMITS.bytes)
      ctx.addIssue({ code: 'custom', path: ['files'], message: 'Program exceeds the bundle limit' });
    if (program.duration.value <= 0)
      ctx.addIssue({ code: 'custom', path: ['duration'], message: 'A program has a positive duration' });
    if (new Set(program.chapters.map((chapter) => chapter.id)).size !== program.chapters.length)
      ctx.addIssue({ code: 'custom', path: ['chapters'], message: 'Repeated chapter identity' });
    for (const [index, chapter] of program.chapters.entries()) {
      if (
        chapter.start.value < 0 ||
        chapter.duration.value <= 0 ||
        RationalTime.compare(RationalTime.add(chapter.start, chapter.duration), program.duration) > 0
      )
        ctx.addIssue({
          code: 'custom',
          path: ['chapters', index],
          message: 'A chapter lies inside the program',
        });
    }
  });
export type AuthoredProgram = z.output<typeof authoredProgramSchema>;

/** Canonical manifest bytes hashed by render and verified by the library. File order cannot alter identity. */
export function authoredProgramDigestInput(program: Omit<AuthoredProgram, 'hash'> | AuthoredProgram): string {
  const checked = authoredProgramSchema.parse({ ...program, hash: '0'.repeat(64) });
  const { hash: _hash, ...manifest } = checked;
  return JSON.stringify({
    ...manifest,
    files: [...manifest.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  });
}

export const authoredProgramItemSchema = z.object({
  type: z.literal('program'),
  id: idSchema<'TimelineItem'>(),
  program: authoredProgramRefSchema,
  sourceStart: rationalTimeSchema.refine((time) => time.value >= 0, 'A nonnegative source start'),
  duration: rationalTimeSchema.refine((time) => time.value > 0, 'A positive duration'),
  locked: z.boolean(),
  enabled: z.boolean(),
  slotId: z.null(),
});
export type AuthoredProgramItem = z.output<typeof authoredProgramItemSchema>;

const target = z.string().min(1).max(500);
const values = z.record(z.string().max(100), z.union([z.string().max(4000), z.number(), z.boolean()]));
/** Host operations, independent of the SDK's wire types and transient animation IDs. */
export const authoredEditSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), target, text: z.string().max(12_000) }),
  z.object({
    kind: z.literal('style'),
    target,
    styles: z.record(z.string().max(100), z.string().max(4000).nullable()),
  }),
  z.object({
    kind: z.literal('attribute'),
    target,
    name: z.string().max(100),
    value: z.string().max(4000).nullable(),
  }),
  z.object({
    kind: z.literal('timing'),
    target,
    start: rationalTimeSchema.refine((time) => time.value >= 0, 'A nonnegative start').optional(),
    duration: rationalTimeSchema.refine((time) => time.value > 0, 'A positive duration').optional(),
  }),
  z.object({ kind: z.literal('remove'), target }),
  z.object({
    kind: z.literal('add'),
    parent: target.nullable(),
    index: z.int().nonnegative(),
    html: z.string().max(64_000),
  }),
  z.object({ kind: z.literal('order'), target, zIndex: z.int() }),
  z.object({
    kind: z.literal('tween'),
    target,
    animationId: target.optional(),
    method: z.enum(['set', 'to', 'from', 'fromTo']).optional(),
    at: rationalTimeSchema.refine((time) => time.value >= 0, 'A nonnegative start'),
    duration: rationalTimeSchema.refine((time) => time.value >= 0, 'A nonnegative duration'),
    ease: z.string().max(100),
    from: values.optional(),
    to: values,
  }),
  z.object({ kind: z.literal('removeTween'), animationId: target }),
  z.object({ kind: z.literal('removeKeyframe'), animationId: target, position: z.number().min(0).max(100) }),
  z.object({ kind: z.literal('removePath'), animationId: target }),
  z.object({
    kind: z.literal('keyframe'),
    animationId: target,
    index: z.int().nonnegative(),
    position: z.number().min(0).max(100),
    values,
    ease: z.string().max(100).optional(),
  }),
  z.object({
    kind: z.literal('path'),
    animationId: target,
    autoRotate: z.boolean(),
    segments: z
      .array(
        z.object({
          cp1: z.object({ x: z.number(), y: z.number() }),
          cp2: z.object({ x: z.number(), y: z.number() }),
        }),
      )
      .min(1)
      .max(100),
  }),
]);
export type AuthoredEdit = z.output<typeof authoredEditSchema>;

export const authoredElementSchema = z.object({
  id: target,
  parentId: target.nullable(),
  tag: z.string().max(100),
  text: z.string().nullable(),
  styles: z.record(z.string(), z.string()),
  attributes: z.record(z.string(), z.string()),
  start: rationalTimeSchema.nullable(),
  duration: rationalTimeSchema.nullable(),
  animationIds: z.array(z.string()),
});
export const authoredAnimationSchema = z.object({
  id: target,
  method: z.enum(['set', 'to', 'from', 'fromTo']).optional(),
  targets: z.array(z.string()),
  at: rationalTimeSchema,
  duration: rationalTimeSchema,
  ease: z.string(),
  from: z.record(z.string(), z.unknown()),
  to: z.record(z.string(), z.unknown()),
  keyframes: z
    .array(
      z.object({
        position: z.number(),
        values: z.record(z.string(), z.unknown()),
        ease: z.string().optional(),
      }),
    )
    .optional(),
  path: z
    .object({
      autoRotate: z.union([z.boolean(), z.number()]),
      segments: z.array(
        z.object({
          cp1: z.object({ x: z.number(), y: z.number() }).optional(),
          cp2: z.object({ x: z.number(), y: z.number() }).optional(),
        }),
      ),
    })
    .optional(),
});
export const authoredInspectionSchema = z.object({
  program: authoredProgramSchema,
  elements: z.array(authoredElementSchema),
  animations: z.array(authoredAnimationSchema),
  source: z.string().max(AUTHORED_PROGRAM_LIMITS.sourceBytes),
});
export type AuthoredInspection = z.output<typeof authoredInspectionSchema>;
