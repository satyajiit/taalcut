// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Phase 2 pseudo-tools (SPEC sections 11 and 13): handOff (a skill's
 * typed result), askUser (a skill's declared question, at most once per run)
 * and startFlow (the main model starts a flow). Like updatePlan they never
 * reach the tool executor; their names have no underscore.
 */
import { exportHandoffProblem } from './editor/export-completion';
import { postCaptionHandoffProblem } from './editor/post-caption-completion';
import { coverHandoffProblem } from './editor/cover-completion';
import { editsHandoffProblem } from './editor/edits-completion';
import {
  chatStartSchema,
  newId,
  ok,
  OPENING_PATHS,
  type AnySkill,
  type AsyncResult,
  type ChatStart,
  type OpeningPath,
} from '@taalcut/core';
import type { ToolSpec } from '@taalcut/models';
import { invalidInputDetail, parseToolInput } from '@taalcut/tools';
import { z } from 'zod';
import type { RunContext } from './context';
import { provisionalTitle } from './chat-title-format';
import { knownIds, mendIds } from './context/id-repair';
import { emitFlowStarted } from './flow-telemetry';
import { flowFacts, flowProblems, seedFlowPlan } from './flows';
import { ASK_USER_TOOL, HAND_OFF_TOOL, START_FLOW_TOOL } from './meta-tools';
import type { EventInput } from './run-log';
import type { ToolCallState } from './run-state';
import { approvalFor } from './state';
import { placeCard, stepCardId, stepRef } from './skill-cards';
import { OFFERED_FORMATS } from './offered-formats';

export const SKILL_META_TOOLS: readonly string[] = [HAND_OFF_TOOL, ASK_USER_TOOL, START_FLOW_TOOL];

const NO_USAGE = { usd: 0, inputTokens: 0, outputTokens: 0 };

export function handOffSpec(skill: AnySkill): ToolSpec {
  return {
    name: HAND_OFF_TOOL,
    description: `Hands the ${skill.id} skill's result to the next step. Call it once the work is done and stored; Taalcut checks it before the plan goes on.`,
    parameters: skill.output,
  };
}

const askInput = z.object({
  question: z.enum(['variants']).describe('variants: how many versions of the video to make'),
  suggested: z.int().min(1).max(10).describe('What you would choose; used as is on autopilot'),
  slotCount: z.int().min(1).max(400).optional().describe('Slots in the template, for the card'),
});

export function askUserSpec(): ToolSpec {
  return {
    name: ASK_USER_TOOL,
    description:
      'Asks the user one of the questions this skill may ask, then waits for the answer. Only if they have not already said.',
    parameters: askInput,
  };
}

const briefInput = z.object({
  text: z.string().trim().min(1).max(500),
  formatId: z.enum(OFFERED_FORMATS).optional(),
  targetSeconds: z.int().min(6).max(120).optional(),
});
const runtimeBriefInput = briefInput.extend({
  text: z.string().trim().min(1).max(4000),
});
const flowInput = (paths: readonly OpeningPath[]) =>
  z.object({
    path: z.enum(paths as [OpeningPath, ...OpeningPath[]]),
    brief: briefInput.optional().describe('describe: what the user asked for, in their words'),
    templateId: z.string().optional().describe('template: the stored template'),
    reference: z
      .object({ kind: z.enum(['link', 'file']), url: z.string().optional(), path: z.string().optional() })
      .optional()
      .describe('reference: the reel link (https) or file the user gave'),
  });
const runtimeFlowInput = (paths: readonly OpeningPath[]) =>
  flowInput(paths).extend({ brief: runtimeBriefInput.optional() });

/** The flows that can run now (every skill and the export tool registered). */
export function runnablePaths(ctx: Pick<RunContext, 'skills' | 'registry'>): OpeningPath[] {
  return OPENING_PATHS.filter(
    (path) =>
      flowProblems(path, ctx.skills, (name) => ctx.registry.describe(name) !== undefined).length === 0,
  );
}

export function startFlowSpec(paths: readonly OpeningPath[]): ToolSpec {
  return {
    name: START_FLOW_TOOL,
    description:
      'Starts a flow: Taalcut runs its skills in order (break down, cast, edit, review) and asks the user once before the export.',
    parameters: flowInput(paths),
  };
}

/** flow.started and the seeded plan, for an opening card's start or startFlow. */
export async function flowStartEvents(
  ctx: RunContext,
  start: ChatStart,
  input?: Record<string, unknown>,
): Promise<EventInput[]> {
  const state = ctx.log.state;
  // The run's project, else the conversation's latest flow's (a chat not linked to a project yet), else a new one.
  let projectId = state.started?.projectId ?? state.started?.lastFlow?.projectId;
  if (!projectId && ctx.phase2.projects && state.started) {
    const name = provisionalTitle(state.started.message) || start.path;
    const project = await ctx.phase2.projects.forConversation(state.started.conversationId, { name });
    if (project.ok) projectId = project.value;
  }
  const flowId = newId<'Flow'>();
  const last = state.started?.lastFlow;
  const cardFlowId = last && (!last.projectId || last.projectId === projectId) ? last.flowId : flowId;
  return [
    [
      'flow.started',
      {
        flowId,
        path: start.path,
        start,
        cardFlowId,
        ...(projectId ? { projectId } : {}),
        ...(input && Object.keys(input).length > 0 ? { input } : {}),
      },
    ],
    ['plan.created', { steps: seedFlowPlan(start.path, ctx.skills) }],
  ];
}

const failed = (call: ToolCallState, code: string, detail: string): EventInput => [
  'tool.failed',
  {
    toolCallId: call.requested.toolCallId,
    error: { code, messageKey: `errors.${code}`, retryable: false, detail },
    attempts: 1,
    durationMs: 0,
    usage: NO_USAGE,
  },
];

const completed = (call: ToolCallState, text: string, extra: { handoff?: unknown } = {}): EventInput => [
  'tool.completed',
  {
    toolCallId: call.requested.toolCallId,
    output: { kind: 'inline', value: text },
    cached: false,
    deduplicated: false,
    attempts: 1,
    durationMs: 0,
    usage: NO_USAGE,
    ...extra,
  },
];

/** Validate a skill's typed handoff and any requested deliverables before recording completion. */
async function handoffEvent(ctx: RunContext, call: ToolCallState): Promise<EventInput> {
  const state = ctx.log.state;
  const step = state.plan?.[state.stepIndex];
  const skill = step?.skill ? ctx.skills.get(step.skill) : undefined;
  if (!skill || !step) return failed(call, 'tools.not_found', 'handOff is for skill steps only.');
  const sent = mendIds(call.requested.input, knownIds(state))?.input ?? call.requested.input;
  const parsed = parseToolInput(skill.output, sent);
  if (!parsed.success) return failed(call, 'tools.invalid_input', invalidInputDetail(sent, parsed.error));
  const problem =
    (await exportHandoffProblem(state, step, parsed.data, ctx.artifacts)) ||
    (await coverHandoffProblem(state, step, parsed.data, ctx.artifacts)) ||
    (await editsHandoffProblem(state, step, parsed.data, ctx.artifacts)) ||
    postCaptionHandoffProblem(state, step, parsed.data);
  if (problem) return failed(call, 'tools.invalid_input', problem);
  return completed(call, 'Handed off. Taalcut is checking it.', { handoff: parsed.data });
}

/** Runs one of handOff, askUser or startFlow. 'deferred': the run pauses for the user's answer. */
export async function runSkillMeta(ctx: RunContext, call: ToolCallState): AsyncResult<'logged' | 'deferred'> {
  const { log } = ctx;
  const state = log.state;
  const step = state.plan?.[state.stepIndex];
  const skill = step?.skill ? ctx.skills.get(step.skill) : undefined;
  const logged = async (...events: EventInput[]) => {
    const written = await log.append(...events);
    return written.ok ? ok('logged' as const) : written;
  };

  if (call.requested.tool === HAND_OFF_TOOL) return logged(await handoffEvent(ctx, call));

  if (call.requested.tool === ASK_USER_TOOL) {
    const parsed = askInput.safeParse(call.requested.input);
    if (!skill || !parsed.success || !skill.questions?.includes(parsed.data.question))
      return logged(failed(call, 'tools.invalid_input', 'This skill may not ask that.'));
    const { question, suggested } = parsed.data;
    const answered = state.answers[question];
    if (answered !== undefined) return logged(completed(call, `The user chose ${answered}.`));
    if (state.started?.autonomy === 'autopilot')
      return logged(completed(call, `Autopilot: go with ${suggested}.`));
    const approval = approvalFor(state, call.requested.toolCallId, 'question');
    if (approval?.status === 'denied') return logged(completed(call, `No answer: go with ${suggested}.`));
    if (approval) return ok('deferred');
    const requestId = newId<'Approval'>();
    const events: EventInput[] = [
      [
        'approval.requested',
        {
          requestId,
          kind: 'question',
          toolCallIds: [call.requested.toolCallId],
          reason: question,
          question,
          suggested,
        },
      ],
    ];
    const card = askingCard(ctx, requestId, suggested, await slotsToAsk(ctx, parsed.data.slotCount));
    if (card)
      events.push(['card.sent', { card, approvalId: requestId, ...(step ? { stepId: step.id } : {}) }]);
    const written = await log.append(...events);
    return written.ok ? ok('deferred') : written;
  }

  // startFlow
  const paths = runnablePaths(ctx);
  const parsed = runtimeFlowInput(paths.length > 0 ? paths : OPENING_PATHS).safeParse(call.requested.input);
  if (!parsed.success) return logged(failed(call, 'tools.invalid_input', z.prettifyError(parsed.error)));
  if (state.flow)
    return logged(failed(call, 'agent.flow_violation', 'A flow is already running in this run.'));
  if (!paths.includes(parsed.data.path))
    return logged(failed(call, 'agent.skill_not_found', `The ${parsed.data.path} flow can't run here.`));
  const { path, brief, templateId, reference } = parsed.data;
  const start = chatStartSchema.safeParse({
    path,
    ...(templateId ? { templateId } : {}),
    ...(reference
      ? {
          reference:
            reference.kind === 'link'
              ? { kind: 'link', url: reference.url }
              : { kind: 'file', path: reference.path },
        }
      : {}),
  });
  if (!start.success) return logged(failed(call, 'tools.invalid_input', z.prettifyError(start.error)));
  const events = await flowStartEvents(ctx, start.data, brief ? { brief } : undefined);
  const result = await logged(...events, completed(call, 'Flow started. Taalcut runs its steps now.'));
  if (result.ok && !ctx.phase2.replay) emitFlowStarted(ctx, log.state);
  return result;
}

/**
 * The template's slots, for the card: the Analyst's handoff in this run, else the template the flow casts (AGT1: a
 * make run started from a breakdown's card has no Analyst step, and the card said "the same 1 slots" for a 13-slot
 * template), else what the model said, else 1.
 */
async function slotsToAsk(ctx: RunContext, said: number | undefined): Promise<number> {
  const state = ctx.log.state;
  const analyst = state.plan?.find((s) => s.flow?.key === 'analyst')?.handedOff?.output as
    { slotCount?: unknown } | undefined;
  if (typeof analyst?.slotCount === 'number') return analyst.slotCount;
  const step = state.plan?.[state.stepIndex];
  const templateId = step ? flowFacts(state, step).templateId : undefined;
  if (typeof templateId === 'string' && ctx.templateSlots && !ctx.phase2.replay) {
    const found = await ctx.templateSlots(templateId);
    if (found.ok && found.value !== undefined && found.value > 0) return found.value;
  }
  return said ?? 1;
}

/** The skill's card while it asks how many variants: the cast board with no cast yet. */
function askingCard(ctx: RunContext, approvalId: string, suggested: number, slots: number) {
  const state = ctx.log.state;
  const step = state.plan?.[state.stepIndex];
  const projectId = state.flow?.projectId ?? state.started?.projectId;
  if (!step || !projectId) return undefined;
  const card = {
    type: 'castBoard' as const,
    id: '',
    version: 1 as const,
    runId: state.runId,
    projectId: projectId as never,
    castId: null,
    timelineIds: [],
    lowConfidence: 0,
    asking: { approvalId, suggested, slotCount: Math.max(1, slots) },
  };
  return placeCard(card, stepCardId(state, step), stepRef(state, step, 'running'));
}
