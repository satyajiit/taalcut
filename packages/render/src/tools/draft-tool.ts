// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `render.draft` (P2-M8, agent SPEC 12): the Reviewer's QA-checked draft of
 * one timeline revision, before the run's one approval. It is an ordinary
 * export with the project's export settings, the same QA gate and no
 * `supersedes`, so the approved `render.export` of the same revision and
 * settings is the same request (exportRequestKey) and returns this render
 * instead of rendering again; and the export card's preview plays it. Not a
 * checkpoint: it runs without asking at "Only before render".
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { defineTool, NO_TOOL_RETRY, ok, RENDER_COMMANDS, ulidSchema, type AnyTool } from '@taalcut/core';
import { DELIVERABLE_VERDICTS } from '../qa/verdict';
import { dispatchAndFollow, exportOutput, exportOutputSchema, type ExportFollowDeps } from './export-follow';
import { renderProgressCard } from './render-cards';
import { slotMisses, slotMissSchema, toolRenderSchema } from './schemas';

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const draftOutputSchema = exportOutputSchema.extend({
  /** The timeline revision the draft shows. */
  timelineRevision: z.int().positive(),
  /** The QA verdict is passed or passedWithWarnings. */
  passed: z.boolean(),
  /**
   * AGT2-MATCH: the slot-match checks the draft misses against its template (slotNeeds, slotFace, slotFraming,
   * slotMotion, slotTiming, slotGraphics), each with its fixes; empty when every slot matches or none was held.
   */
  slotMatch: z.array(slotMissSchema),
});

export function renderDraftTool(deps: ExportFollowDeps): AnyTool {
  return defineTool({
    name: 'render.draft',
    version: '1.1.0',
    summary: 'Renders a QA-checked draft of one timeline revision, before the export approval.',
    description:
      'Renders the timeline revision with the project export settings and runs every QA check on it, without ' +
      'asking: the draft the export card previews. Returns the render, whether it passed QA, the failing checks ' +
      'with their fixes, the slots that differ from the template (slotMatch) with theirs, and the QA report. ' +
      'Approving the export of the same revision delivers this render without rendering again.',
    tags: ['render', 'draft', 'qa', 'review', 'preview'],
    input: z.object({
      projectId: ulidSchema('Project'),
      timelineId: ulidSchema('Timeline'),
      revision: z.int().positive().describe('The timeline revision to render (the Editor hands it off)'),
    }),
    output: draftOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: RENDER_COMMANDS.export,
    timeoutMs: 30 * 60_000,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['library', 'project'], write: ['app-data'] }, network: 'none' },
    idempotencyKey: (input) => sha256(['render.draft', input.projectId, input.timelineId, input.revision]),
    resultCard: async (output, ctx) => {
      const card = renderProgressCard(toolRenderSchema.parse(output.render), ctx);
      return card.ok ? ok(card.value) : card;
    },
    summarize: (output) =>
      `Draft ${output.render.id} of revision ${output.timelineRevision}: ` +
      (output.passed ? 'QA passed' : `QA ${output.render.qa?.verdict ?? output.render.status}`) +
      (output.failing.length > 0 ? `, ${output.failing.length} failing` : '') +
      (output.slotMatch.length > 0 ? `, ${output.slotMatch.length} slot checks missed` : ''),
    run: async (input, ctx) => {
      const record = await dispatchAndFollow(
        deps,
        {
          projectId: input.projectId,
          timelineId: input.timelineId,
          timelineRevision: input.revision,
          notify: false,
        },
        ctx,
      );
      if (!record.ok) return record;
      const output = await exportOutput(record.value, ctx);
      if (!output.ok) return output;
      const verdict = record.value.qa?.verdict;
      return ok({
        ...output.value,
        timelineRevision: record.value.timelineRevision,
        passed: verdict !== undefined && verdict !== 'overridden' && DELIVERABLE_VERDICTS.has(verdict),
        slotMatch: slotMisses(record.value.qaReport),
      });
    },
  }) as AnyTool;
}
