// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A composition's variables (DSG1's parameters, HFW1): its words, its colours and its flags, and the values a graphic
 * gives them. Apart from the composition record so the timeline's graphics can name values without a cycle.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { hexColorSchema } from './template-parts';

/** A parameter's name: what markup binds (`data-text`, `data-if`), CSS reads (`var(--name)`) and items set. */
export const graphicParamNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9]{0,23}$/);

/**
 * A composition's variables: its words, which side it sits on, its colour tokens, its size, and flags such as
 * typing dots or read ticks. Each has a default, so a composition draws with no values at all.
 */
export const graphicParamSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    name: graphicParamNameSchema,
    maxLength: z.int().min(1).max(500),
    /** Words the gate draws when no value is given. Untrusted, shown as text only. */
    sample: z.string().trim().min(1).max(500),
  }),
  z.strictObject({
    type: z.literal('enum'),
    name: graphicParamNameSchema,
    options: z.array(z.string().regex(/^[a-z][a-zA-Z0-9-]{0,23}$/)).min(2).max(8),
    default: z.string().max(24),
  }),
  z.strictObject({ type: z.literal('boolean'), name: graphicParamNameSchema, default: z.boolean() }),
  z.strictObject({ type: z.literal('colour'), name: graphicParamNameSchema, default: hexColorSchema }),
  z.strictObject({
    type: z.literal('number'),
    name: graphicParamNameSchema,
    min: z.number().finite(),
    max: z.number().finite(),
    default: z.number().finite(),
  }),
]);
export type GraphicParam = z.output<typeof graphicParamSchema>;

/** Values for a composition's variables, by name; absent ones take the default. */
export const graphicParamValuesSchema = z
  .record(graphicParamNameSchema, z.union([z.string().max(500), z.number().finite(), z.boolean()]))
  .refine((values) => Object.keys(values).length <= 16, { message: 'At most 16 parameter values' });
export type GraphicParamValues = z.output<typeof graphicParamValuesSchema>;
