// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX: a docked run's turn in the loop (SPEC section 38). A message that asks for a change goes to the Editor
 * skill as the run's one step, with no planning turn and no make flow; when the run ends, the changes card lists
 * what its turn did to the timeline, from the brief's snapshot before and the timeline after. In a docked run the
 * changes card stands for the Editor's own timeline card.
 */
import {
  agentTurnGroup,
  diffEdits,
  editSnapshot,
  type Card,
  type EditChangesCard,
  type EditItemTarget,
} from '@taalcut/core';
import type { RunContext } from '../context';
import type { EventInput } from '../run-log';
import type { RunState } from '../run-state';
import { placeCard } from '../skill-cards';

/** The skill a docked change goes to. */
export const EDITOR_SKILL = 'timeline.editor';

/** A planner may omit ids already known by the dock; keep the same context as a directly routed edit. */
export function editorStepInput(state: RunState, input: unknown): unknown {
  if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input)))
    return input;
  const supplied = (input ?? {}) as Record<string, unknown>;
  const brief = state.started?.editor;
  if (
    !brief ||
    (supplied.timelineId !== undefined && supplied.timelineId !== brief.context.timelineId) ||
    (supplied.projectId !== undefined && supplied.projectId !== brief.projectId)
  )
    return input;
  const request = state.started?.message.trim().slice(0, 2_000);
  return {
    projectId: brief.projectId,
    timelineId: brief.context.timelineId,
    ...(brief.templateId ? { templateId: brief.templateId } : {}),
    ...(request ? { request } : {}),
    targets: brief.targets,
    context: brief.context,
    ...supplied,
  };
}

/**
 * The plan for a docked message that asks for a change: one Editor step with the timeline, its template, the
 * user's words and what they point at. Undefined when the run isn't one, or the Editor isn't there or can't take
 * this input: the run then plans as any other.
 */
export function editorPlan(ctx: RunContext): EventInput | undefined {
  const state = ctx.log.state;
  const brief = state.started?.editor;
  if (!brief || brief.route !== 'edit') return undefined;
  const skill = ctx.skills.get(EDITOR_SKILL);
  if (!skill) return undefined;
  const message = state.started?.message ?? '';
  const parsed = skill.input.safeParse(editorStepInput(state, undefined));
  if (!parsed.success) return undefined;
  return [
    'plan.created',
    {
      steps: [{ id: 's1', text: stepText(message, brief.targets), skill: EDITOR_SKILL, input: parsed.data }],
    },
  ];
}

/**
 * The Editor step's text: the user's words, then the kinds of what they point at ("remove it" with a graphic
 * selected reads "remove it (selected: graphic)"). The step text searches the tool catalogue, so a bare "it" or
 * "this" finds the tools for what is selected.
 */
export function stepText(message: string, targets: readonly EditItemTarget[]): string {
  const kinds = [...new Set(targets.map((target) => target.itemKind))];
  const words = message.trim().slice(0, 200);
  return kinds.length > 0 ? `${words} (selected: ${kinds.join(', ')})` : words;
}

/** True for the Editor's timeline card in a docked run: the changes card says more. */
export function replacedByChanges(state: RunState, card: Card): boolean {
  return state.started?.editor !== undefined && card.type === 'timeline';
}

/**
 * The changes card for a docked run whose turn changed the timeline; nothing when it didn't, when the timeline
 * can't be read, or in replay (the log has the card).
 */
export async function changesCard(ctx: RunContext): Promise<EventInput[]> {
  const state = ctx.log.state;
  const brief = state.started?.editor;
  const editor = ctx.phase3.editor;
  if (!brief || !editor || ctx.phase2.replay) return [];
  const now = await editor.timeline(brief.context.timelineId);
  if (!now.ok || now.value.revision === brief.before.revision) return [];
  const after = editSnapshot(now.value);
  const { changes, more } = diffEdits(brief.before, after);
  if (changes.length === 0) return [];
  const card: EditChangesCard = {
    type: 'editChanges',
    id: `edit-changes:${state.runId}`,
    version: 1,
    runId: state.runId,
    projectId: now.value.projectId,
    timelineId: now.value.id,
    group: agentTurnGroup(state.runId),
    revisionBefore: brief.before.revision,
    revisionAfter: after.revision,
    changes,
    more,
  };
  const placed = placeCard(card, card.id, undefined);
  return placed ? [['card.sent', { card: placed }]] : [];
}
