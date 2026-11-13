// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The cards the fake agent's flows send (agent SPEC sections 13 and 14), each
 * under the id the real agent uses (`step:<flowId>:<skill>`), so re-sending
 * one updates it in place. Only the shapes: fake-flow.ts puts them in order.
 */
import type {
  Card,
  CardOf,
  FlowStepRef,
  Id,
  OpeningPath,
  PlanStepStatus,
  QaSummary,
  RunId,
} from '@taalcut/core';
import { GOLDEN_HOUR } from '../backend/fake/templates/template-plans';
import { templateIdOf } from '../backend/fake/templates/template-data';
import { FLOW_PROJECT_ID } from '../backend/fake/fake-projects';

export const FLOW_PROJECT: Id<'Project'> = FLOW_PROJECT_ID;
export const FLOW_TIMELINE = '01K7C5M6Q8R9S0T1V2W3X4Y5ZB' as Id<'Timeline'>;
export const FLOW_TEMPLATE = templateIdOf(GOLDEN_HOUR);
/** The fake's Golden hour market is at version 2: the breakdown hands that version off. */
const TEMPLATE_VERSION = 2;
const usd = (micros: number) => ({ currency: 'USD', micros });

/** A flow's skills in order, by path (agent SPEC section 13), plus the export at the end. */
export const FLOW_STEPS: Readonly<Record<OpeningPath, readonly { skill: string; labelKey: string }[]>> = {
  reference: [
    { skill: 'templates.analyst', labelKey: 'skills.templates.analyst' },
    { skill: 'timeline.librarian', labelKey: 'skills.timeline.librarian' },
    { skill: 'timeline.editor', labelKey: 'skills.timeline.editor' },
    { skill: 'render.reviewer', labelKey: 'skills.render.reviewer' },
    { skill: 'render.export', labelKey: 'flows.step.export' },
  ],
  template: [
    { skill: 'timeline.librarian', labelKey: 'skills.timeline.librarian' },
    { skill: 'timeline.editor', labelKey: 'skills.timeline.editor' },
    { skill: 'render.reviewer', labelKey: 'skills.render.reviewer' },
    { skill: 'render.export', labelKey: 'flows.step.export' },
  ],
  describe: [
    { skill: 'timeline.librarian', labelKey: 'skills.timeline.librarian' },
    { skill: 'timeline.editor', labelKey: 'skills.timeline.editor' },
    { skill: 'render.reviewer', labelKey: 'skills.render.reviewer' },
    { skill: 'render.export', labelKey: 'flows.step.export' },
  ],
  library: [
    { skill: 'agent.brief', labelKey: 'skills.agent.brief' },
    { skill: 'timeline.librarian', labelKey: 'skills.timeline.librarian' },
    { skill: 'timeline.editor', labelKey: 'skills.timeline.editor' },
    { skill: 'render.reviewer', labelKey: 'skills.render.reviewer' },
    { skill: 'render.export', labelKey: 'flows.step.export' },
  ],
};

export interface FlowContext {
  readonly runId: RunId;
  readonly flowId: Id<'Flow'>;
  readonly path: OpeningPath;
  readonly renderId: Id<'Render'>;
  readonly exportRenderId: Id<'Render'>;
}

export const stepIdOf = (skill: string) => skill.replace('.', '-');

export function plan(ctx: FlowContext, statuses: readonly PlanStepStatus[]): CardOf<'plan'> {
  return {
    type: 'plan',
    id: `plan:${ctx.runId}`,
    version: 1,
    runId: ctx.runId,
    steps: FLOW_STEPS[ctx.path].map((step, i) => ({
      id: stepIdOf(step.skill),
      text: '',
      labelKey: step.labelKey,
      status: statuses[i] ?? 'pending',
    })),
  };
}

export function stepRef(
  ctx: FlowContext,
  skill: string,
  status: FlowStepRef['status'],
  edited = false,
): FlowStepRef {
  const steps = FLOW_STEPS[ctx.path];
  return {
    flowId: ctx.flowId,
    stepId: stepIdOf(skill),
    skill,
    index: steps.findIndex((step) => step.skill === skill) + 1,
    count: steps.length,
    status,
    editedByYou: edited,
  };
}

const cardId = (ctx: FlowContext, skill: string) => `step:${ctx.flowId}:${skill}`;

export function brief(ctx: FlowContext, status: FlowStepRef['status'], summary?: string): CardOf<'step'> {
  return {
    type: 'step',
    id: cardId(ctx, 'agent.brief'),
    version: 1,
    runId: ctx.runId,
    step: stepRef(ctx, 'agent.brief', status),
    labelKey: 'skills.agent.brief',
    ...(summary ? { summary } : {}),
    progress: null,
    refs: [],
  };
}

export function cost(
  ctx: FlowContext,
  skill: string,
  status: 'going-ahead' | 'settled',
  micros: number,
  spentMicros: number,
): CardOf<'costEstimate'> {
  const vision = { module: 'vision' as const, provider: 'google', model: 'gemini-2.5-flash', local: false };
  return {
    type: 'costEstimate',
    id: `cost:${ctx.flowId}:${skill}`,
    version: 2,
    runId: ctx.runId,
    projectId: FLOW_PROJECT,
    phase: {
      labelKey: FLOW_STEPS[ctx.path].find((s) => s.skill === skill)?.labelKey ?? 'skills.agent.brief',
      skill,
    },
    estimate: { money: usd(micros), tokens: Math.round(micros / 3) },
    lines: [{ ...vision, money: usd(micros), tokens: Math.round(micros / 3) }],
    cap: { cap: usd(2_000_000), spent: usd(spentMicros) },
    cheaper: [
      { module: 'vision', provider: 'on-device', model: 'qwen3.5-4b', local: true, estimate: usd(0) },
      {
        module: 'vision',
        provider: 'google',
        model: 'gemini-2.5-flash-lite',
        local: false,
        estimate: usd(micros / 3),
      },
    ],
    status,
    ...(status === 'settled'
      ? { actual: { money: usd(Math.round(micros * 0.85)), tokens: Math.round(micros / 3.4) } }
      : {}),
  };
}

export function breakdown(ctx: FlowContext, stage: CardOf<'breakdown'>['stage'], fraction: number | null) {
  const ready = stage === 'ready';
  return {
    type: 'breakdown',
    id: cardId(ctx, 'templates.analyst'),
    version: 1,
    runId: ctx.runId,
    step: stepRef(ctx, 'templates.analyst', ready ? 'ready' : 'running'),
    stage,
    progress: ready ? null : { fraction },
    source: { input: 'link', platform: 'reels', duration: { value: 450, rate: { num: 30, den: 1 } } },
    template: ready ? { id: FLOW_TEMPLATE, version: TEMPLATE_VERSION } : null,
  } satisfies CardOf<'breakdown'>;
}

export function castBoard(ctx: FlowContext, ready: boolean): CardOf<'castBoard'> {
  return {
    type: 'castBoard',
    id: cardId(ctx, 'timeline.librarian'),
    version: 1,
    runId: ctx.runId,
    step: stepRef(ctx, 'timeline.librarian', ready ? 'ready' : 'running'),
    projectId: FLOW_PROJECT,
    castId: ready ? ('01K7C5M6Q8R9S0T1V2W3X4Y5ZE' as Id<'Cast'>) : null,
    timelineIds: ready ? [FLOW_TIMELINE] : [],
    lowConfidence: ready ? 1 : 0,
  };
}

export function timeline(ctx: FlowContext): CardOf<'timeline'> {
  return {
    type: 'timeline',
    id: cardId(ctx, 'timeline.editor'),
    version: 1,
    runId: ctx.runId,
    step: stepRef(ctx, 'timeline.editor', 'ready'),
    projectId: FLOW_PROJECT,
    timelineId: FLOW_TIMELINE,
    revision: 3,
    duration: { value: 450, rate: { num: 30, den: 1 } },
    clipCount: 12,
  };
}

const QA: QaSummary = {
  verdict: 'passedWithWarnings',
  round: 1,
  passed: 17,
  warned: 1,
  failed: 0,
  fixed: 1,
  failing: [],
};

export function draft(ctx: FlowContext, ready: boolean): CardOf<'renderProgress'> {
  return {
    type: 'renderProgress',
    id: `render:${ctx.renderId}`,
    version: 1,
    runId: ctx.runId,
    renderId: ctx.renderId,
    projectId: FLOW_PROJECT,
    presetId: 'reels',
    status: ready ? 'ready' : 'rendering',
    progress: { fraction: ready ? 1 : 0.4 },
    notify: false,
    qa: ready ? QA : null,
  };
}

export function qaReport(ctx: FlowContext): CardOf<'qaReport'> {
  return {
    type: 'qaReport',
    id: cardId(ctx, 'render.reviewer'),
    version: 1,
    runId: ctx.runId,
    step: stepRef(ctx, 'render.reviewer', 'ready'),
    renderId: ctx.renderId,
    projectId: FLOW_PROJECT,
    summary: QA,
    checks: [],
  };
}

export function exportApproval(
  ctx: FlowContext,
  approvalId: string,
  status: CardOf<'exportApproval'>['status'],
): CardOf<'exportApproval'> {
  return {
    type: 'exportApproval',
    id: `export:${ctx.flowId}:1`,
    version: 1,
    runId: ctx.runId,
    approvalId,
    projectId: FLOW_PROJECT,
    timelineId: FLOW_TIMELINE,
    timelineRevision: 3,
    presetId: 'reels',
    presets: ['shorts', 'reels', 'tiktok'],
    captions: { burnIn: true, sidecars: [] },
    // REF1: Golden hour keeps its reel, so the video has the reel's music by default.
    music: 'referenceAudio',
    draft: { renderId: ctx.renderId, qa: QA },
    status,
    ...(status === 'exporting' || status === 'exported' ? { renderId: ctx.exportRenderId } : {}),
  };
}

export function exported(ctx: FlowContext, ready: boolean): CardOf<'renderProgress'> {
  return {
    ...draft(ctx, ready),
    id: `render:${ctx.exportRenderId}`,
    renderId: ctx.exportRenderId,
    progress: { fraction: ready ? 1 : 0.6 },
    survey: true,
  };
}

export function budgetCap(
  ctx: FlowContext,
  approvalId: string,
  status: CardOf<'budgetCap'>['status'],
): CardOf<'budgetCap'> {
  return {
    type: 'budgetCap',
    id: `cap:${approvalId}`,
    version: 1,
    runId: ctx.runId,
    projectId: FLOW_PROJECT,
    approvalId,
    cap: usd(2_000_000),
    spent: usd(1_920_000),
    next: { labelKey: 'skills.timeline.librarian', estimate: usd(140_000) },
    suggestedCap: usd(2_500_000),
    cheaper: [
      { module: 'vision', provider: 'on-device', model: 'qwen3.5-4b', local: true, estimate: usd(0) },
      {
        module: 'vision',
        provider: 'google',
        model: 'gemini-2.5-flash-lite',
        local: false,
        estimate: usd(40_000),
      },
    ],
    status,
  };
}

export function anotherOne(ctx: FlowContext): Card {
  return {
    type: 'openingChoices',
    id: `opening:${ctx.runId}`,
    version: 1,
    runId: ctx.runId,
    paths: ['library', 'reference', 'template', 'describe'],
    unavailable: [],
    hasSources: true,
  };
}
