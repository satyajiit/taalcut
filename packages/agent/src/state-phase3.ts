// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fold for Phase 3's log types (phase3-events.ts). Part of state.ts's pure fold: the same events give the
 * same state live, after a restart and in replay. Returns false for a type it doesn't know.
 */
import type { SkillQuestion } from '@taalcut/core';
import type { AgentEvent } from './events';
import { applyLimitEvent } from './limits/limit-fold';
import type { RunState } from './run-state';

export function applyPhase3Event(state: RunState, event: AgentEvent): boolean {
  switch (event.type) {
    case 'route.shadow':
      // A new decision: a live route of an earlier turn no longer narrows anything.
      state.liveRoute = undefined;
      state.routes.push({ kind: 'shadow', ...event.payload });
      return true;
    case 'route.timeout':
      state.liveRoute = undefined;
      state.routes.push({ kind: 'timeout', ...event.payload });
      return true;
    case 'route.override':
      state.routes.push({ kind: 'override', ...event.payload });
      return true;
    case 'flow.extensionChecked':
      state.extensionChecks.push({ ...event.payload });
      return true;
    case 'flow.extended':
      state.extensions.push({
        extension: event.payload.extension,
        stepId: event.payload.stepId,
        seq: event.seq,
        ...(event.payload.data !== undefined ? { data: event.payload.data } : {}),
      });
      return true;
    case 'limit.waiting':
    case 'limit.resumed':
    case 'limit.switched':
      applyLimitEvent(state, event);
      return true;
    case 'step.corrected': {
      // AGT1: the note goes in the step's turns; the step ends if the model still answers in words after it.
      const step = state.plan?.find((s) => s.id === event.payload.stepId);
      if (step) {
        step.corrections = (step.corrections ?? 0) + 1;
        step.correctedAt = event.payload.textTurns;
        step.toldAt = state.transcript.length;
      }
      state.transcript.push({ kind: 'control', text: event.payload.text });
      return true;
    }
    case 'step.progress':
      // AGT2: the round's note goes in the step's turns.
      state.transcript.push({ kind: 'control', text: event.payload.text });
      return true;
    case 'context.compacted':
      // Nothing to fold: the prompt is rebuilt from the state, condensed again with the logged window.
      return true;
    default:
      return false;
  }
}

/**
 * P3-B8: the fix per gap; a declined question ([] or no) leaves every gap on the film list. FIX-ASK: with the seq of
 * the question it answers, so a later round of the step's facts knows the answer was for an earlier one.
 */
export function applyPhase3Answer(
  state: RunState,
  question: SkillQuestion | undefined,
  event: Extract<AgentEvent, { type: 'approval.granted' | 'approval.denied' }>,
  askedSeq?: number,
): void {
  if (question !== 'gapFix') return;
  if (askedSeq !== undefined) state.gapFixesAsked = askedSeq;
  state.gapFixes =
    event.type === 'approval.granted' && event.payload.answer?.kind === 'gapFix'
      ? event.payload.answer.fixes.map((f) => ({
          gapId: f.gapId,
          fix: f.fix,
          ...(f.swapTo ? { swapTo: { assetId: f.swapTo.assetId, shotId: f.swapTo.shotId } } : {}),
        }))
      : [];
}
