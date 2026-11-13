// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The cards a flow shows (SPEC sections 11 and 13): each skill step's live
 * card under one id per flow (`step:<flowId>:<skill>`, so a re-run, a
 * follow-up run or a refresh updates it in place), with the step's place in
 * the flow; and the plain `step` card for steps whose skill has no card.
 * Cards are logged (`card.sent`), so history shows what the live chat did.
 */
import { parseCard, type AnySkill, type Card, type FlowStepRef, type SkillContext } from '@taalcut/core';
import type { RunContext } from './context';
import type { EventInput } from './run-log';
import type { RunState, StepState } from './run-state';

/** Card types that carry a flow step reference. */
const STEP_CARDS = new Set<Card['type']>([
  'step',
  'sourcePicker',
  'breakdown',
  'castBoard',
  'timeline',
  'qaReport',
]);

/** The flow whose ids cards use: this run's, or the conversation's latest for the same project. */
export function cardFlowId(state: RunState): string {
  return state.flow?.cardFlowId ?? state.started?.lastFlow?.flowId ?? state.flow?.flowId ?? state.runId;
}

export function stepCardId(state: RunState, step: StepState): string {
  const variant = step.flow?.variant ?? 1;
  return `step:${cardFlowId(state)}:${step.skill ?? step.flow?.key ?? step.id}${variant > 1 ? `:${variant}` : ''}`;
}

export function exportCardId(state: RunState, step: StepState): string {
  return `export:${cardFlowId(state)}:${step.flow?.variant ?? 1}`;
}

/** "Step 2 of 4": the step's place among the flow's steps that will run. */
export function stepRef(
  state: RunState,
  step: StepState,
  status: FlowStepRef['status'],
  editedByYou = false,
): FlowStepRef | undefined {
  if (!state.flow) return undefined;
  const steps = (state.plan ?? []).filter((s) => s.flow && s.status !== 'skipped');
  const index = Math.max(1, steps.findIndex((s) => s.id === step.id) + 1);
  return {
    flowId: cardFlowId(state) as FlowStepRef['flowId'],
    stepId: step.id,
    index,
    count: Math.max(index, steps.length),
    ...(step.skill ? { skill: step.skill } : {}),
    status,
    editedByYou,
  };
}

/** What card and check hooks need from a run: its log and its stop signal. */
export type CardContext = Pick<RunContext, 'log' | 'signal'>;

export function skillContext(ctx: CardContext, step: StepState): SkillContext {
  const state = ctx.log.state;
  const projectId = state.flow?.projectId ?? state.started?.projectId;
  return {
    runId: ctx.log.runId,
    projectId: (projectId ?? null) as SkillContext['projectId'],
    flowId: (state.flow?.flowId ?? null) as SkillContext['flowId'],
    stepId: step.id,
    signal: ctx.signal,
  };
}

/** Puts the card under its flow id and step, and checks it against core's card protocol. */
export function placeCard(card: Card, id: string, ref: FlowStepRef | undefined): Card | undefined {
  const placed = { ...card, id, ...(ref && STEP_CARDS.has(card.type) ? { step: ref } : {}) };
  const parsed = parseCard(placed);
  return parsed.ok ? parsed.value : undefined;
}

/** The skill's own card for its handoff, or a plain step card for flow steps whose skill has none. */
export async function handoffCard(
  ctx: CardContext,
  step: StepState,
  skill: AnySkill,
  output: unknown,
  editedByYou = false,
): Promise<Card | undefined> {
  const state = ctx.log.state;
  const ref = stepRef(state, step, 'ready', editedByYou);
  if (skill.card) {
    try {
      const card = await skill.card(output as never, skillContext(ctx, step));
      return card.ok && card.value ? placeCard(card.value, stepCardId(state, step), ref) : undefined;
    } catch {
      return undefined;
    }
  }
  return ref ? plainStepCard(state, step, ref, output) : undefined;
}

export function plainStepCard(
  state: RunState,
  step: StepState,
  ref: FlowStepRef,
  output?: unknown,
): Card | undefined {
  const text = (output as { text?: unknown } | undefined)?.text;
  return placeCard(
    {
      type: 'step',
      id: '',
      version: 1,
      runId: state.runId,
      step: ref,
      labelKey: step.labelKey ?? `skills.${step.skill ?? step.flow?.key ?? 'step'}`,
      ...(typeof text === 'string' ? { summary: text.slice(0, 2000) } : {}),
      refs: (step.handedOff?.refs ?? []).slice(0, 20),
    } as Card,
    stepCardId(state, step),
    ref,
  );
}

/** Settles an open step card (`running`) as failed when its step ends in failure. */
export function settleOpenStepCard(state: RunState, step: StepState): Card | undefined {
  const id = stepCardId(state, step);
  const open = state.cards[id];
  if (!open || !('step' in open) || open.step?.status !== 'running') return undefined;
  const ref = stepRef(state, step, 'failed');
  if (!ref) return undefined;
  const cleaned = 'asking' in open ? ({ ...open, asking: undefined } as Card) : open;
  return placeCard(cleaned, id, ref) ?? placeCard(open, id, ref);
}

/** card.sent event settling an open step card as failed when not replaying. */
export function failedStepCardEvents(
  state: RunState,
  step: StepState | undefined,
  replay = false,
): EventInput[] {
  if (!step || replay) return [];
  const card = settleOpenStepCard(state, step);
  return card ? [['card.sent', { card, stepId: step.id }]] : [];
}
