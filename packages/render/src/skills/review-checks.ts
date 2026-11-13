// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Reviewer's deterministic checks before a handoff is accepted (the
 * second method, agent SPEC 11). The draft review (the flow's Reviewer,
 * before the one approval): the handoff must say what the stored QA report
 * says, for exactly the timeline version reviewed, and every fix must be one
 * the Editor can apply. The post-export review (a finished render's report,
 * the supersede chain of section 10) keeps its own shape and check.
 */
import { z } from 'zod';
import {
  captionCommandPayloads,
  libraryCommandPayloads,
  musicCommandPayloads,
  QA_MAX_ROUNDS,
  QA_VERDICTS,
  qaCheckIdSchema,
  qaFixSchema,
  renderCommandPayloads,
  timelineCommandPayloads,
  ulidSchema,
  type QaFix,
  type RenderRecord,
  type SkillVerdict,
} from '@taalcut/core';
import { DELIVERABLE_VERDICTS } from '../qa/verdict';

/** Every command a QA fix may name, with its payload schema. */
const COMMAND_PAYLOADS: Readonly<Record<string, z.ZodType>> = {
  ...captionCommandPayloads,
  ...musicCommandPayloads,
  ...renderCommandPayloads,
  ...timelineCommandPayloads,
  ...libraryCommandPayloads,
};

/** Why a fix can't go to the Editor as it is; null when it can. */
export function fixProblem(fix: QaFix, where: string): string | null {
  if (fix.kind === 'auto') return `The fix for ${where} is an auto fix; the render process applies those.`;
  if (fix.kind !== 'command') return null;
  const schema = COMMAND_PAYLOADS[fix.command];
  if (!schema) return `Unknown command ${fix.command} in the fix for ${where}.`;
  if (!schema.safeParse(fix.payload).success)
    return `The payload for ${fix.command} doesn't match the command; copy it from the report.`;
  return null;
}

/** The flow's Reviewer hands off this: the draft, the version it shows, and what the Editor fixes. */
export const draftReviewOutputSchema = z.object({
  renderId: ulidSchema('Render').describe('The draft render.draft returned'),
  timelineVersion: z.int().positive().describe('The timeline revision the draft shows'),
  passed: z.boolean().describe("True when the draft's QA verdict is passed or passedWithWarnings"),
  fixes: z
    .array(qaFixSchema)
    .max(5)
    .describe('For the Editor when not passed: command and agent fixes as the report gives them'),
});
export type DraftReview = z.output<typeof draftReviewOutputSchema>;

/** The draft review against the stored render: version, verdict and fixes must all agree. */
export function checkDraftReview(output: DraftReview, record: RenderRecord): SkillVerdict {
  if (record.timelineRevision !== output.timelineVersion)
    return {
      verdict: 'retry',
      reason:
        `Render ${record.id} shows revision ${record.timelineRevision}, not ${output.timelineVersion}: ` +
        'draft the version you were given with render.draft and hand off its renderId.',
    };
  const report = record.qaReport;
  if (!report)
    return {
      verdict: 'retry',
      reason: `Render ${record.id} has no QA report yet: draft the timeline with render.draft and wait for it.`,
    };
  const passed = DELIVERABLE_VERDICTS.has(report.verdict);
  if (output.passed !== passed)
    return {
      verdict: 'retry',
      reason: `The QA verdict of render ${record.id} is ${report.verdict}, so passed is ${String(passed)}.`,
    };
  if (!passed && output.fixes.length === 0)
    return {
      verdict: 'retry',
      reason: 'The draft failed QA: hand off at least one fix for the Editor from the failing checks.',
    };
  for (const [index, fix] of output.fixes.entries()) {
    const problem = fixProblem(fix, `fix ${index + 1}`);
    if (problem) return { verdict: 'retry', reason: problem };
  }
  return { verdict: 'pass' };
}

/** A finished render's review (render SPEC 10): steps for the Editor, then a re-export or the user. */
export const postExportReviewSchema = z.object({
  renderId: ulidSchema('Render'),
  verdict: z.enum(QA_VERDICTS),
  round: z.int().min(1).max(QA_MAX_ROUNDS),
  /** What the Editor does next, one fix per step, in order. */
  editorSteps: z.array(z.object({ checkId: qaCheckIdSchema, fix: qaFixSchema })).max(20),
  /** editor: apply the steps and stop; reexport: apply them, then export again with supersedes; user: hand back. */
  next: z.enum(['editor', 'reexport', 'user']),
});
export type ReviewerHandoff = z.output<typeof postExportReviewSchema>;

/** The post-export check: no re-export past round three, and every command fix a real command. */
export function verifyReviewerHandoff(output: ReviewerHandoff): SkillVerdict {
  if (output.next === 'reexport' && output.round >= QA_MAX_ROUNDS)
    return {
      verdict: 'retry',
      reason: `Round ${output.round} is the last one: hand back to the user (next "user").`,
    };
  if (output.next === 'reexport' && output.editorSteps.length === 0)
    return { verdict: 'retry', reason: 'A re-export needs at least one Editor step.' };
  for (const step of output.editorSteps) {
    const problem = fixProblem(step.fix, step.checkId);
    if (problem) return { verdict: 'retry', reason: problem };
  }
  return { verdict: 'pass' };
}
