// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fold for Phase 2's log types (skills, flows, estimates, cards). Part
 * of state.ts's pure fold: the same events give the same state live, after a
 * restart and in replay.
 */
import { CHAT_EFFECT_SPECS, type EntityRef, type RationalTime, type SelectionChip } from '@taalcut/core';
import type { AgentEvent } from './events';
import type { RunState, StepState } from './run-state';

/** The note that starts a skill's turns, followed by its input as JSON. */
export const SKILL_INPUT_NOTE = 'Skill input:';
const MAX_INPUT_NOTE = 4_000;

/** Flow runs: the project cap governs money, so the run itself has no money limit (SPEC section 14). */
export const FLOW_BUDGET = { maxTokens: 400_000, maxWallClockMs: 45 * 60_000 } as const;

const FLOW_SKILL_IDS = new Set([
  'templates.analyst',
  'timeline.librarian',
  'timeline.maker',
  'render.reviewer',
]);

/** Planned flow skills get more time/tokens; only an actual flow delegates its money limit to a project cap. */
export function upgradeFlowSkillBudget(state: RunState): void {
  if (state.flow) return;
  const started = state.started?.budget;
  if (
    !started ||
    started.maxTokens !== 200_000 ||
    started.maxWallClockMs !== 15 * 60_000 ||
    started.maxUsd !== 0.5
  )
    return;
  if ((state.plan ?? []).some((s) => s.skill !== undefined && FLOW_SKILL_IDS.has(s.skill))) {
    state.budget = { ...state.budget, ...FLOW_BUDGET };
  }
}

export function applyFlowEvent(state: RunState, event: AgentEvent, step: StepState | undefined): void {
  switch (event.type) {
    case 'skill.entered':
      if (!step) break;
      step.entered = {
        input: event.payload.input,
        at: event.at,
        usage: { tokens: state.usage.tokens, usd: state.usage.usd },
      };
      // The skill's turns start from its input: ids and the user's own words, never media text.
      state.transcript.push({
        kind: 'control',
        text: `${SKILL_INPUT_NOTE} ${(JSON.stringify(event.payload.input) ?? '{}').slice(0, MAX_INPUT_NOTE)}`,
      });
      break;
    case 'skill.handedOff': {
      const target = stepById(state, event.payload.stepId);
      if (!target) break;
      target.handedOff = {
        output: event.payload.output ?? target.handoff,
        refs: event.payload.refs,
        at: event.at,
      };
      break;
    }
    case 'step.skipped': {
      const target = stepById(state, event.payload.stepId);
      if (target) target.status = 'skipped';
      break;
    }
    case 'flow.started':
      state.flow = event.payload;
      state.budget = { ...FLOW_BUDGET };
      break;
    case 'flow.inputChanged':
      state.inputChanges.push({ seq: event.seq, ...event.payload, applied: false });
      break;
    case 'estimate.recorded': {
      state.estimates[event.payload.estimateId] = { recorded: event.payload };
      const target = event.payload.stepId ? stepById(state, event.payload.stepId) : undefined;
      if (target) target.estimateId = event.payload.estimateId;
      break;
    }
    case 'estimate.settled': {
      const estimate = state.estimates[event.payload.estimateId];
      if (estimate) estimate.settled = event.payload.actual;
      break;
    }
    case 'card.sent':
      state.cards[event.payload.card.id] = event.payload.card;
      break;
    case 'flow.abandoned':
      state.flowAbandoned = true;
      break;
    default:
      break;
  }
}

export function stepById(state: RunState, stepId: string): StepState | undefined {
  return state.plan?.find((s) => s.id === stepId);
}

/** The newest version of each stored thing the run's steps handed off or saw the user change. */
export function knownVersions(state: RunState): Map<string, number> {
  const known = new Map<string, number>();
  const note = (ref: EntityRef) => {
    const key = refKey(ref);
    known.set(key, Math.max(known.get(key) ?? 0, ref.version));
  };
  for (const s of state.plan ?? []) for (const ref of s.handedOff?.refs ?? []) note(ref);
  for (const change of state.inputChanges) for (const ref of change.refs) note(ref);
  return known;
}

export const refKey = (ref: Pick<EntityRef, 'entity' | 'id'>) => `${ref.entity}:${ref.id}`;

const time = (t: RationalTime) => `frame ${t.value} at ${t.rate.num}/${t.rate.den} fps`;

/** The note the first prompt gets when the user pointed at things (V3): each chip's ids, times, or tagged effects. */
export function selectionNote(selections: readonly SelectionChip[]): string {
  const lines = selections.map((chip) => {
    if (chip.kind === 'clip') return `- clip ${chip.clipId} in timeline ${chip.timelineId}`;
    if (chip.kind === 'item') return `- ${chip.itemKind} ${chip.itemId} in timeline ${chip.timelineId}`;
    if (chip.kind === 'slot') return `- slot ${chip.slotId} of template ${chip.templateId}`;
    if (chip.kind === 'effect') {
      const spec = CHAT_EFFECT_SPECS[chip.effectId];
      return `- effect "${spec.label}" (${spec.id}): ${spec.instruction}`;
    }
    if (chip.kind === 'asset')
      return `- library asset ${chip.assetId}${chip.name ? ` ("${chip.name}")` : ''}`;
    return `- timeline ${chip.timelineId} from ${time(chip.range.start)}, ${chip.range.duration.value} frames long`;
  });
  return `The user selected:\n${lines.join('\n')}`;
}
