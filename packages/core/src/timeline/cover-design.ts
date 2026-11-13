// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { z } from 'zod';

const unit = z.number().finite().min(0).max(1);
export const COVER_COLOR_ROLES = ['ink', 'paper', 'accent', 'muted', 'transparent'] as const;
const colorRole = z.enum(COVER_COLOR_ROLES);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const coverPaletteSchema = z.object({
  ink: color,
  paper: color,
  accent: color,
  muted: color,
});
export const coverDesignBoxSchema = z
  .object({
    x: unit,
    y: unit,
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .refine(
    (box) => box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001,
    'Layer box must fit the canvas',
  );
const point = { x: unit, y: unit };
export const coverPathCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('M'), ...point }),
  z.object({ command: z.literal('L'), ...point }),
  z.object({ command: z.literal('Q'), cx: unit, cy: unit, ...point }),
  z.object({ command: z.literal('C'), c1x: unit, c1y: unit, c2x: unit, c2y: unit, ...point }),
  z.object({ command: z.literal('Z') }),
]);
const layer = {
  box: coverDesignBoxSchema,
  opacity: unit.default(1),
  rotation: z.number().finite().min(-180).max(180).default(0),
};
export const coverDesignLayerSchema = z.discriminatedUnion('kind', [
  z.object({
    ...layer,
    kind: z.literal('text'),
    text: z.string().min(1).max(180),
    // Only existing shipped fonts; font weight should be resolved to actual available weight by renderer.
    font: z.enum(['notoSans', 'poppins', 'montserrat', 'anton', 'bebasNeue']).default('notoSans'),
    fontSize: z.number().finite().min(0.012).max(0.25), // share of the canvas's shorter edge
    weight: z.number().int().min(100).max(900).default(700),
    lineHeight: z.number().finite().min(1).max(1.8).default(1.08),
    letterSpacing: z.number().finite().min(-0.08).max(0.2).default(-0.02), // em
    align: z.enum(['left', 'center', 'right']).default('left'),
    color: colorRole.default('ink'),
  }),
  z.object({
    ...layer,
    kind: z.literal('shape'),
    shape: z.enum(['rectangle', 'ellipse']),
    fill: colorRole,
    stroke: colorRole.default('transparent'),
    strokeWidth: z.number().finite().min(0).max(0.05).default(0), // share of shorter canvas edge
    radius: z.number().finite().min(0).max(0.2).default(0),
  }),
  z.object({
    ...layer,
    kind: z.literal('path'),
    commands: z
      .array(coverPathCommandSchema)
      .min(2)
      .max(64)
      .refine((commands) => commands[0]?.command === 'M', 'Paths must start with a move command'),
    fill: colorRole.default('transparent'),
    stroke: colorRole.default('ink'),
    strokeWidth: z.number().finite().min(0.001).max(0.08).default(0.01), // share of local path box's shorter edge
    dashed: z.boolean().default(false),
  }),
]);
export const coverDesignSchema = z.object({
  version: z.literal(1),
  palette: coverPaletteSchema,
  backdrop: z
    .object({
      fit: z.enum(['cover', 'contain']).default('cover'),
      x: unit.default(0.5),
      y: unit.default(0.5),
    })
    .optional(),
  layers: z.array(coverDesignLayerSchema).min(1).max(16),
});
export type CoverDesign = z.output<typeof coverDesignSchema>;
export type CoverDesignLayer = z.output<typeof coverDesignLayerSchema>;
export type CoverPathCommand = z.output<typeof coverPathCommandSchema>;
