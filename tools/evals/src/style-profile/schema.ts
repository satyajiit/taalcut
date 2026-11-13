// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Style profile labels (LRN1-STY). A case is a set of templates, as the app exports them, with the profile's numbers
 * worked out by hand, and renders made like the set (or not) with the QA verdict they should get. Real labels are a
 * person's: a set of their own breakdowns with the numbers counted from the references. Synthetic ones say so.
 * Labels live in `labels/style-profile/*.json`, each file a list of cases.
 */
import { migrateTemplate } from '@taalcut/templates';
import { z } from 'zod';
import { loadLabelRows } from '../labelled-files';

const idSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be lowercase words separated by hyphens');

/**
 * One template of the set as the app exports it (any schema version), migrated to the current one. Real labels are
 * the person's own breakdowns; synthetic ones are built by @taalcut/templates' syntheticTemplate.
 */
export const labelTemplateSchema = z.looseObject({ schemaVersion: z.int().min(1) }).transform((json, ctx) => {
  const migrated = migrateTemplate(json, json.schemaVersion);
  if (migrated.ok) return migrated.value;
  ctx.addIssue({
    code: 'custom',
    message: `not a template: ${migrated.error.code} ${migrated.error.detail ?? ''}`,
  });
  return z.NEVER;
});

const bandSchema = z
  .object({ n: z.int().nonnegative(), q1: z.number(), median: z.number(), q3: z.number() })
  .strict();

/** The numbers worked out by hand: what profileOf must give. */
export const expectedProfileSchema = z
  .object({
    members: z.int().min(1),
    shot: bandSchema,
    cutsOnBeat: z.number().nullable(),
    shotsInFirst3s: bandSchema,
    /** The commonest first shot. */
    hookShotType: z.string().min(1),
    /** Transitions between shots, commonest first, with counts. */
    transitions: z.array(z.object({ value: z.string().min(1), count: z.int().min(1) }).strict()),
    length: bandSchema,
    aspect: z.string().min(1),
  })
  .strict();
export type ExpectedProfile = z.infer<typeof expectedProfileSchema>;

/** A render of a project made like the set: its shots, and the stylePacing verdict it should get. */
export const labelRenderSchema = z
  .object({
    name: idSchema,
    fps: z.int().min(1).max(120),
    shots: z.array(z.int().min(1)).min(1),
    expect: z.enum(['pass', 'fail']),
  })
  .strict();
export type LabelRender = z.infer<typeof labelRenderSchema>;

export const styleProfileCaseSchema = z
  .object({
    caseId: idSchema,
    synthetic: z.boolean(),
    templates: z.array(labelTemplateSchema).min(1),
    expected: expectedProfileSchema,
    renders: z.array(labelRenderSchema),
    note: z.string().optional(),
  })
  .strict();
export type StyleProfileCase = z.output<typeof styleProfileCaseSchema>;
/** A case as a label file holds it: its templates as JSON documents. */
export type StyleProfileLabel = z.input<typeof styleProfileCaseSchema>;

export const loadStyleProfileCases = (dir: string): StyleProfileCase[] =>
  loadLabelRows(dir, {
    what: 'style profile cases',
    schema: z.array(styleProfileCaseSchema),
    idOf: (row) => row.caseId,
    idName: 'case',
  });
