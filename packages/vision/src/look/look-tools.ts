// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * vision.matchLook 1.0.0: a template's stored look Style, or a clip measured by vision.measureLook.
 * No model and no network. A template with no look Style is `note: 'noLook'`, not an error. Ids are plain ULID
 * strings (`ulidSchema`) so the schemas convert to JSON Schema for the model.
 */
import { createHash } from 'node:crypto';
import {
  defineTool,
  fontMatchSchema,
  lookStatsSchema,
  NO_TOOL_RETRY,
  ok,
  timeRangeSchema,
  ulidSchema,
  type AsyncResult,
  type JobRunner,
  type StyleStore,
} from '@taalcut/core';
import { z } from 'zod';
import { visionMeasureLookJob } from './grade-jobs';

export const MATCH_LOOK_TIMEOUT_MS = 120_000;

const templateSource = z
  .object({
    templateId: ulidSchema('Template').describe('Reference template whose look Style to read'),
    version: z.int().min(1).optional().describe('One template version; omit to take the latest look'),
  })
  .strict();

const assetSource = z
  .object({
    assetId: ulidSchema('Asset').describe('Library clip to measure'),
    range: timeRangeSchema.describe('The part of the clip to measure'),
  })
  .strict();

export const matchLookInputSchema = z.object({
  source: z.union([templateSource, assetSource]),
});
export type MatchLookInput = z.output<typeof matchLookInputSchema>;

export const matchLookOutputSchema = z.object({
  styleId: ulidSchema('Style').nullable(),
  colour: lookStatsSchema.nullable(),
  fontMatch: fontMatchSchema.nullable(),
  note: z.literal('noLook').optional(),
});
export type MatchLookOutput = z.output<typeof matchLookOutputSchema>;

export interface MatchLookDeps {
  readonly styles: StyleStore;
  readonly jobs: JobRunner;
}

const NO_LOOK: MatchLookOutput = { styleId: null, colour: null, fontMatch: null, note: 'noLook' };

async function fromTemplate(
  styles: StyleStore,
  source: z.output<typeof templateSource>,
): AsyncResult<MatchLookOutput> {
  const madeFrom =
    source.version === undefined
      ? { templateId: source.templateId }
      : { templateId: source.templateId, version: source.version };
  const listed = await styles.list({ madeFrom });
  if (!listed.ok) return listed;
  const looks = listed.value.filter((style) => style.kind === 'look');
  looks.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const chosen = looks[0];
  if (!chosen) return ok(NO_LOOK);
  const full = await styles.get(chosen.id);
  if (!full.ok) return full;
  return ok({
    styleId: full.value.id,
    colour: full.value.grade?.target ?? null,
    fontMatch: full.value.fontMatch,
  });
}

export function createMatchLookTool(deps: MatchLookDeps) {
  return defineTool({
    name: 'vision.matchLook',
    version: '1.0.0',
    description:
      'Finds the colour look and on-screen font of a reference template, or measures a clip, for a look Style. ' +
      'A template made before a look was stored returns note noLook. Runs on this Mac; no model is called.',
    summary: 'Finds a template colour look and font, or measures a clip.',
    tags: ['look', 'colour', 'grade', 'font', 'style'],
    input: matchLookInputSchema,
    output: matchLookOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: MATCH_LOOK_TIMEOUT_MS,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['library'] }, network: 'none' },
    idempotencyKey: (input) => createHash('sha256').update(JSON.stringify(input.source)).digest('hex'),
    run: (input, ctx) => {
      const source = input.source;
      if ('templateId' in source) return fromTemplate(deps.styles, source);
      return deps.jobs
        .run(visionMeasureLookJob, { assetId: source.assetId, range: source.range }, { signal: ctx.signal })
        .then((measured) =>
          measured.ok ? ok({ styleId: null, colour: measured.value.look, fontMatch: null }) : measured,
        );
    },
  });
}
