// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stand-in skill modules shaped like the domain packages' (templates'
 * Analyst, timeline's Librarian and Editor, render's Reviewer): core's
 * defineSkill, typed inputs and handoffs, a deterministic second method over
 * the world, cards from core's protocol. They import only @taalcut/core and
 * zod, as a domain package would.
 */
import {
  defineSkill,
  defineSkillModule,
  FORMAT_IDS,
  FrameRates,
  ok,
  type AnySkill,
  type ProjectId,
  type SkillModule,
  ULID_PATTERN,
} from '@taalcut/core';
import { z } from 'zod';
import type { World } from './flow-world';

const ulid = z.string().regex(ULID_PATTERN);
const reference = z.object({
  kind: z.enum(['link', 'file']),
  url: z.string().optional(),
  path: z.string().optional(),
});

export interface SkillOptions {
  /** The Librarian's paid tools (vision reranks), before it starts. */
  readonly rerankEstimateUsd?: number;
  /** The Analyst's check fails this many times before it passes (retry), or for good (fail). */
  readonly analystCheck?: 'pass' | 'retry-once' | 'fail';
  /** The Analyst's own turn limit (the real one's is in packages/templates' analyst.ts). */
  readonly analystMaxTurns?: number;
  /** AGT2: a Maker stand-in in the timeline module (a skill's id starts with its module's). */
  readonly maker?: AnySkill;
}

export function flowSkillModules(world: World, options: SkillOptions = {}): SkillModule[] {
  let analystChecks = 0;
  const analyst = defineSkill({
    id: 'templates.analyst',
    version: '1.0.0',
    labelKey: 'skills.templates.analyst',
    description: 'Breaks a reference reel down into a template.',
    prompt: 'Call templates.breakdown with the reference, then hand off the template.',
    tools: { families: ['templates'] },
    input: z.object({ projectId: ulid, reference }),
    output: z.object({
      templateId: ulid,
      version: z.int().min(1),
      slotCount: z.int().min(1),
      unconfirmedCuts: z.array(z.int()),
    }),
    refs: (out) => [{ entity: 'template', id: out.templateId, version: out.version }],
    ...(options.analystMaxTurns ? { limits: { maxTurns: options.analystMaxTurns } } : {}),
    async verify(out) {
      analystChecks += 1;
      if (options.analystCheck === 'fail') return ok({ verdict: 'fail', reason: 'Cuts disagree.' });
      if (options.analystCheck === 'retry-once' && analystChecks === 1)
        return ok({ verdict: 'retry', reason: 'Cut 3 was found by one method only.' });
      if (world.templates.get(out.templateId) !== out.version)
        return ok({ verdict: 'retry', reason: 'Hand off the current version.' });
      return ok({ verdict: 'pass' });
    },
    card: async (out, ctx) =>
      ok({
        type: 'breakdown',
        id: 'analyst-own-id',
        version: 1,
        runId: ctx.runId,
        stage: 'ready',
        progress: null,
        source: { input: 'link', platform: 'reels', duration: { value: 900, rate: FrameRates.fps30 } },
        template: { id: out.templateId as never, version: out.version },
      }),
  });

  const librarian = defineSkill({
    id: 'timeline.librarian',
    version: '1.0.0',
    labelKey: 'skills.timeline.librarian',
    description: "Casts the user's shots into the template, in 1 to 10 variants.",
    prompt: 'Ask how many variants unless the user said, cast with timeline.cast, then hand off.',
    tools: { families: ['timeline'] },
    input: z
      .object({
        projectId: ulid,
        templateId: ulid.optional(),
        brief: z.object({ text: z.string().min(1), formatId: z.enum(FORMAT_IDS).optional() }).optional(),
        variants: z.int().min(1).max(10).optional(),
      })
      .refine((i) => (i.templateId === undefined) !== (i.brief === undefined)),
    output: z.object({
      timelineIds: z.array(ulid).min(1).max(10),
      revisions: z.array(z.int().min(1)),
      templateId: ulid.optional(),
      lowConfidenceSlots: z.int(),
      reranked: z.int(),
    }),
    questions: ['variants'],
    limits: { expectedTurns: 3 },
    refs: (out) =>
      out.timelineIds.map((id, i) => ({ entity: 'timeline', id, version: out.revisions[i] ?? 1 })),
    async verify(out) {
      const stale = out.timelineIds.find((id, i) => world.timelines.get(id) !== out.revisions[i]);
      return ok(stale ? { verdict: 'retry', reason: `Timeline ${stale} moved on.` } : { verdict: 'pass' });
    },
    estimate: async () => ok({ usd: options.rerankEstimateUsd ?? 0, basis: 'reranks' }),
    card: async (out, ctx) =>
      ok({
        type: 'castBoard',
        id: 'librarian-own-id',
        version: 1,
        runId: ctx.runId,
        projectId: (ctx.projectId ?? world.projectId) as ProjectId,
        castId: null,
        timelineIds: out.timelineIds as never[],
        lowConfidence: out.lowConfidenceSlots,
      }),
  });

  const editor = defineSkill({
    id: 'timeline.editor',
    version: '1.0.0',
    labelKey: 'skills.timeline.editor',
    description: 'Trims cuts onto beats and applies QA fixes.',
    prompt: 'Trim with timeline.trimClip, then hand off the timeline at its new revision.',
    tools: { names: ['timeline.trimClip'] },
    input: z.object({
      projectId: ulid,
      timelineId: ulid,
      templateId: ulid,
      fixes: z.array(z.unknown()).optional(),
    }),
    output: z.object({ timelineId: ulid, revision: z.int().min(1) }),
    refs: (out) => [{ entity: 'timeline', id: out.timelineId, version: out.revision }],
    async verify(out) {
      const now = world.timelines.get(out.timelineId);
      return ok(
        now === out.revision ? { verdict: 'pass' } : { verdict: 'retry', reason: `It is at ${now}.` },
      );
    },
    card: async (out, ctx) =>
      ok({
        type: 'timeline',
        id: 'editor-own-id',
        version: 1,
        runId: ctx.runId,
        projectId: (ctx.projectId ?? world.projectId) as ProjectId,
        timelineId: out.timelineId as never,
        revision: out.revision,
        duration: { value: 900, rate: FrameRates.fps30 },
        clipCount: 4,
      }),
  });

  const reviewer = defineSkill({
    id: 'render.reviewer',
    version: '1.0.0',
    labelKey: 'skills.render.reviewer',
    description: 'Renders a draft, runs QA and sends failing checks back as fixes.',
    prompt: 'Call render.review for the timeline, then hand off what it found.',
    tools: { names: ['render.review'] },
    input: z.object({ projectId: ulid, timelineId: ulid, timelineRevision: z.int().min(1) }),
    output: z.object({
      renderId: ulid,
      timelineRevision: z.int().min(1),
      passed: z.boolean(),
      fixes: z.array(z.object({ checkId: z.string(), action: z.string() })),
    }),
    refs: (out) => [{ entity: 'render', id: out.renderId, version: world.renders.get(out.renderId) ?? 1 }],
    async verify(out) {
      const reviewed = world.qa[world.reviews - 1] ?? true;
      return ok(
        reviewed === out.passed
          ? { verdict: 'pass' }
          : { verdict: 'retry', reason: 'passed disagrees with QA.' },
      );
    },
    card: async (out, ctx) =>
      ok({
        type: 'qaReport',
        id: 'reviewer-own-id',
        version: 1,
        runId: ctx.runId,
        renderId: out.renderId as never,
        projectId: (ctx.projectId ?? world.projectId) as ProjectId,
        summary: {
          verdict: out.passed ? 'passed' : 'needsAttention',
          round: 1,
          passed: out.passed ? 20 : 19,
          warned: 0,
          failed: out.passed ? 0 : 1,
          fixed: 0,
          failing: out.passed ? [] : ['blackFrames'],
        },
        checks: out.passed
          ? []
          : [
              {
                id: 'blackFrames',
                status: 'fail',
                labelKey: 'qa.blackFrames',
                overridable: false,
                fixes: [],
              },
            ],
      }),
  });

  return [
    defineSkillModule({ id: 'templates', skills: [analyst] }),
    defineSkillModule({
      id: 'timeline',
      skills: [librarian, editor, ...(options.maker ? [options.maker] : [])] as AnySkill[],
    }),
    defineSkillModule({ id: 'render', skills: [reviewer] }),
  ];
}
