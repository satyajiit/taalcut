// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Reviewer (P2-M8, agent SPEC 12): in a flow, after the Editor and
 * before the one approval, it renders a QA-checked draft of the timeline
 * version it was given (`render.draft`), reads the failing checks, may look
 * at frames, and hands off whether the draft passed and the fixes the Editor
 * applies. Nothing that hasn't passed is offered for approval (gate
 * criterion 4); the approved export of the same version is this draft.
 * Its check before the handoff is deterministic (review-checks.ts), and its
 * card is the draft's QA report.
 */
import { z } from 'zod';
import {
  defineSkill,
  defineSkillModule,
  err,
  ok,
  qaReportCardSchema,
  ulidSchema,
  ValidationError,
  type AnySkill,
  type AsyncResult,
  type Card,
  type RenderId,
  type RenderStore,
  type SkillContext,
  type SkillModule,
} from '@taalcut/core';
import { cardChecks, summarize } from '../qa/verdict';
import { designerSkill, type DesignerSkillDeps } from './designer';
import { checkDraftReview, draftReviewOutputSchema, type DraftReview } from './review-checks';

export const REVIEWER_SKILL_ID = 'render.reviewer';

/** What the flow knows when the Reviewer starts (agent flowFacts: `version` is the Editor's revision). */
export const reviewerInputSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  version: z.int().positive().describe('The timeline revision to review'),
});

export interface RenderSkillDeps {
  /** The renders the draft review reads (the library's renders table). */
  readonly store: Pick<RenderStore, 'get'>;
  /**
   * HFW1: the Designer, over these timelines, where the workspace tools are registered (its tools must all be, or
   * the module isn't composed and the Reviewer goes with it). Absent: no Designer.
   */
  readonly designer?: DesignerSkillDeps;
  /** EAR1-A3: whether a tool is registered, for the listening tools (audio.critique, audio.compare). Absent: none. */
  readonly registered?: (tool: string) => boolean;
}

/** EAR1-A3: the listening tools the Reviewer may use when the composition registers them. */
const REVIEWER_LISTEN_TOOLS = ['audio.critique', 'audio.compare'] as const;

const PROMPT = [
  'You are Taal working as the Reviewer. Nothing reaches the user before it passes QA.',
  'Render a draft of the timeline version you were given with render.draft (projectId, timelineId, and',
  'revision set to that version). It runs every QA check and waits for the result.',
  'If the draft passed, hand off passed true with its renderId and timelineVersion and no fixes.',
  'If it did not, read the failing checks (render.getQaReport has the details; call timeline.captureFrame',
  'with source "render" when a finding names frames you need to see) and hand off passed false with at most',
  'five fixes for the Editor: command fixes exactly as the report gives them (never edit their payloads), and',
  'agent fixes as the report gives them (the Editor judges those: swap a frozen or dark shot from its',
  'alternates, trim it, shorten a text). Leave out auto fixes: the render process has applied them.',
  'Reframe and voice-over-music failures carry command fixes (timeline.setReframe, captions.setStyle,',
  'music.setDucking): pass them on as given. A motion graphic places and sizes itself: its failures carry agent',
  'fixes with its itemId (move it, larger words) that the Editor asks the Designer for with graphics.design, and',
  'one on too short a ready graphics.edit of its length. A brandAssets warning is about',
  "the user's Style: mention it, never change the Style.",
  // LRN1-STY.
  "A stylePacing failure means the project is made like a set of the user's references and its shots run",
  'faster or slower than theirs: pass its agent fix on, and the Editor re-times the shots it names.',
  // EAR1-A3.
  'A soundOnCuts or soundClean failure carries its agent fix: pass it on. When soundCritique warns and the',
  'Editor needs more than its fixes, audio.critique scores the sound in full and audio.compare says how it',
  'differs from a reference.',
  'Never override a check: only the user can. Alongside handOff, state the QA verdict in one plain sentence and stop, with no follow-up questions.',
].join(' ');

const cardId = (ctx: Pick<SkillContext, 'flowId' | 'runId'>) =>
  `step:${ctx.flowId ?? ctx.runId}:${REVIEWER_SKILL_ID}`;

/** The draft's QA report as the step's card. */
async function reviewCard(
  deps: RenderSkillDeps,
  output: DraftReview,
  ctx: SkillContext,
): AsyncResult<Card | undefined> {
  const record = await deps.store.get(output.renderId as RenderId);
  if (!record.ok) return record;
  const report = record.value.qaReport;
  if (!report) return ok(undefined);
  const parsed = qaReportCardSchema.safeParse({
    type: 'qaReport',
    id: cardId(ctx),
    version: 1,
    runId: ctx.runId,
    renderId: record.value.id,
    projectId: record.value.projectId,
    summary: record.value.qa ?? summarize(report),
    checks: cardChecks(report).map((check) => ({
      id: check.id,
      status: check.status,
      labelKey: check.labelKey,
      overridable: check.overridable,
      fixes: check.fixes.slice(0, 3),
    })),
  });
  return parsed.success
    ? ok(parsed.data)
    : err(ValidationError({ field: 'card' }, { detail: z.prettifyError(parsed.error) }));
}

export function reviewerSkill(deps: RenderSkillDeps) {
  return defineSkill({
    id: REVIEWER_SKILL_ID,
    // 2.4.0 (HFW1): a motion graphic's failures are agent fixes for graphics.design, not graphics.edit commands.
    // 2.5.0 (EAR1-A3): audio.critique and audio.compare, where registered; the sound checks' fixes.
    version: '2.5.0',
    labelKey: 'skills.render.reviewer',
    description:
      'Renders a QA-checked draft of a timeline version before the export approval and hands back whether it ' +
      'passed and the fixes the Editor applies.',
    prompt: PROMPT,
    tools: {
      names: [
        'render.draft',
        'render.getQaReport',
        'timeline.captureFrame',
        ...REVIEWER_LISTEN_TOOLS.filter((name) => deps.registered?.(name) ?? false),
      ],
    },
    input: reviewerInputSchema,
    output: draftReviewOutputSchema,
    // A draft has no supersede chain, so its QA round is 1.
    refs: (output) => [{ entity: 'render', id: output.renderId, version: 1 }],
    async verify(output, ctx) {
      const record = await deps.store.get(output.renderId as RenderId);
      if (!record.ok)
        return ok({
          verdict: 'retry',
          reason: `No render ${output.renderId} (${record.error.code}): hand off the renderId render.draft returned.`,
        });
      if (ctx.projectId && record.value.projectId !== ctx.projectId)
        return ok({ verdict: 'retry', reason: `Render ${output.renderId} belongs to another project.` });
      return ok(checkDraftReview(output, record.value));
    },
    card: (output, ctx) => reviewCard(deps, output, ctx),
    limits: { expectedTurns: 3, maxTurns: 8 },
  });
}

/** Render's skills for the agent's skill registry: the Reviewer, and the Designer where it can run. */
export function createRenderSkillModule(deps: RenderSkillDeps): SkillModule {
  return defineSkillModule({
    id: 'render',
    skills: [
      reviewerSkill(deps),
      ...(deps.designer ? [designerSkill(deps.designer) as unknown as AnySkill] : []),
    ],
  });
}
