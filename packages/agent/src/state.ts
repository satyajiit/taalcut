// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * RunState: a pure fold over the run's events. The same fold drives the live
 * loop, resume after a crash, replay and the trace, so nothing about a run
 * lives only in memory.
 */
import type { RunId } from '@taalcut/core';
import type { AgentEvent, ApprovalKind, PlanStep } from './events';
import {
  initialState,
  type ApprovalState,
  type RunState,
  type StepState,
  type ToolCallState,
} from './run-state';
import { commentBatchNote } from './comments/comment-note';
import { applyFlowEvent, selectionNote, upgradeFlowSkillBudget } from './state-flow';
import { applyPhase3Answer, applyPhase3Event } from './state-phase3';

export {
  initialState,
  type ApprovalState,
  type RunState,
  type StepState,
  type ToolCallState,
  type TranscriptItem,
} from './run-state';

export function foldEvents(runId: RunId, events: readonly AgentEvent[]): RunState {
  const state = initialState(runId);
  for (const event of events) applyEvent(state, event);
  return state;
}

/** Applies one event in place. Total: unknown types only move lastSeq. */
export function applyEvent(state: RunState, event: AgentEvent): void {
  const before = state.transcript.length;
  applyOne(state, event);
  // AGT1: what each item was written in, for compaction (context/compaction.ts) and the corrective note.
  if (state.stepIndex < 0) return;
  for (let index = before; index < state.transcript.length; index++)
    state.transcript[index] = { ...state.transcript[index]!, step: state.stepIndex };
}

function applyOne(state: RunState, event: AgentEvent): void {
  // Wall clock counts active time only: not while paused, not across a crash.
  if (state.status === 'running' && state.lastSeq >= 0 && event.type !== 'run.resumed') {
    state.usage.activeMs += Math.max(0, event.at - state.lastAt);
  }
  state.lastAt = event.at;
  state.lastSeq = event.seq;
  const step = state.plan?.[state.stepIndex];

  switch (event.type) {
    case 'run.started':
      state.started = event.payload;
      state.budget = { ...event.payload.budget };
      state.transcript.push({ kind: 'user', text: event.payload.message });
      if (event.payload.selections?.length)
        state.transcript.push({ kind: 'control', text: selectionNote(event.payload.selections) });
      if (event.payload.pointerNote)
        state.transcript.push({ kind: 'control', text: event.payload.pointerNote });
      // EDT1-CMT: the comments to answer, their words fenced (comments/comment-note.ts).
      if (event.payload.comments)
        state.transcript.push({ kind: 'control', text: commentBatchNote(event.payload.comments) });
      break;
    case 'plan.created':
      state.plan = event.payload.steps.map(newStep);
      upgradeFlowSkillBudget(state);
      break;
    case 'plan.updated': {
      const plan = (state.plan ??= []);
      const incoming = event.payload.steps;
      const after = event.payload.insertAfter;
      const first = incoming[0];
      if (
        after === undefined &&
        plan.length === 1 &&
        plan[0]!.id === 's1' &&
        !plan[0]!.skill &&
        !plan[0]!.tool &&
        plan[0]!.status === 'doing' &&
        first &&
        !first.skill &&
        !first.tool &&
        !incoming.some((s) => s.id === 's1')
      ) {
        plan[0]!.text = first.text;
        plan.push(...incoming.slice(1).map(newStep));
      } else {
        const known = new Map(plan.map((s) => [s.id, s]));
        const added: StepState[] = [];
        for (const s of incoming) {
          const existing = known.get(s.id);
          if (existing) existing.text = s.text;
          else added.push(newStep(s));
        }
        const at = after === undefined ? -1 : plan.findIndex((s) => s.id === after);
        if (at >= 0) plan.splice(at + 1, 0, ...added);
        else plan.push(...added);
      }
      for (const change of state.inputChanges)
        if (event.payload.applies?.includes(change.seq)) change.applied = true;
      upgradeFlowSkillBudget(state);
      break;
    }
    case 'step.started': {
      state.stepIndex = event.payload.index;
      const started = state.plan?.[event.payload.index];
      if (started) {
        started.status = 'doing';
        // A plan turn that answered without tools closes the (only) step at once.
        started.ended =
          !started.skill && !started.tool && state.lastTurn?.phase === 'plan' && !state.lastTurn.hadToolCalls;
        started.summary = started.ended ? (state.lastTurn?.text ?? '') : '';
      }
      // Tool steps run with no model turn, so the model needs no note for them.
      if (event.payload.index > 0 && !started?.tool) {
        const total = state.plan?.length ?? 0;
        const text = event.payload.text || (started?.skill ? `the ${started.skill} skill` : '');
        state.transcript.push({
          kind: 'control',
          text: `Step ${event.payload.index + 1} of ${total}: ${text}`,
        });
      }
      break;
    }
    case 'route.chosen': {
      state.loadedTools = mergeTools(state.loadedTools, event.payload.tools);
      const routed = state.plan?.find((s) => s.id === event.payload.stepId);
      if (routed && event.payload.by !== 'router') routed.routedTools = event.payload.tools;
      if (routed && event.payload.window !== undefined) routed.window = event.payload.window;
      if (routed && event.payload.by !== 'router' && routed.query === undefined)
        routed.query = event.payload.query;
      state.liveRoute = event.payload.by === 'router' ? event.payload.family : undefined;
      break;
    }
    case 'model.requested':
      if (step && event.payload.phase === 'act') step.lastToolNames = event.payload.toolNames;
      state.openModelCall = {
        modelCallId: event.payload.modelCallId,
        phase: event.payload.phase,
        module: event.payload.module ?? 'agent',
      };
      if (event.payload.overBudget) state.modelBudgetAllowance = Math.max(0, state.modelBudgetAllowance - 1);
      break;
    case 'model.responded': {
      const phase = state.openModelCall?.phase ?? 'act';
      const module = state.openModelCall?.module ?? 'agent';
      state.spend[module] = (state.spend[module] ?? 0) + event.payload.usage.costUsd;
      state.openModelCall = undefined;
      state.liveRoute = undefined;
      state.turns += 1;
      state.usage.tokens += event.payload.usage.totalTokens;
      // FIX-RUN: a plan's tokens are free to the person too, like a model on this Mac's.
      const free = event.payload.local || event.payload.planBilled === true;
      if (!free) state.usage.paidTokens += event.payload.usage.totalTokens;
      state.freeModules = { ...state.freeModules, [module]: free };
      state.modelRetries = 0;
      state.usage.usd += event.payload.usage.costUsd;
      state.modelUsage.tokens += event.payload.usage.totalTokens;
      state.modelUsage.usd += event.payload.usage.costUsd;
      const hadToolCalls = event.payload.toolCalls.length > 0;
      state.lastTurn = { phase, hadToolCalls, text: event.payload.text };
      state.transcript.push({
        kind: 'assistant',
        modelCallId: event.payload.modelCallId,
        message: event.payload.message,
        toolCallIds: [],
      });
      if (step && phase === 'act') {
        step.turns += 1;
        if (event.payload.text.trim().length > 0) step.summary = event.payload.text;
        // A skill step ends only on a valid handOff; its text-only turns in a row are counted (the text loop).
        if (step.skill) step.textTurns = hadToolCalls ? 0 : (step.textTurns ?? 0) + 1;
        // AGT1: a tool call after a corrective note ends that loop; the next one may be corrected again.
        if (hadToolCalls) step.correctedAt = undefined;
        if (!hadToolCalls && step.skill)
          state.transcript.push({ kind: 'control', text: 'Hand off with handOff.' });
        else if (!hadToolCalls) {
          step.ended = true;
          step.summary = event.payload.text;
        }
      }
      break;
    }
    case 'model.failed':
      state.openModelCall = undefined;
      state.modelRetries = event.payload.retry ? event.payload.retry.attempt : 0;
      break;
    case 'tool.requested': {
      const id = event.payload.toolCallId;
      state.toolCalls[id] = { requested: event.payload, requestedAt: event.at };
      state.toolCallOrder.push(id);
      const turn = state.transcript.findLast(
        (item) => item.kind === 'assistant' && item.modelCallId === event.payload.modelCallId,
      );
      if (turn?.kind === 'assistant') turn.toolCallIds.push(id);
      if (step?.tool && event.payload.modelCallId === flowCallId(step.id)) step.toolCallId = id;
      break;
    }
    case 'tool.completed':
    case 'tool.failed': {
      const call = state.toolCalls[event.payload.toolCallId];
      if (!call) break;
      call.outcome =
        event.type === 'tool.completed'
          ? { kind: 'completed', at: event.at, payload: event.payload }
          : { kind: 'failed', at: event.at, payload: event.payload };
      state.usage.usd += event.payload.usage.usd;
      state.usage.tokens += event.payload.usage.inputTokens + event.payload.usage.outputTokens;
      // A tool's model use counts against the budget when it cost money (on this Mac it reports US$0).
      if (event.payload.usage.usd > 0)
        state.usage.paidTokens += event.payload.usage.inputTokens + event.payload.usage.outputTokens;
      if (event.payload.usage.usd > 0) {
        const module = call.requested.cloudModule ?? 'agent';
        state.spend[module] = (state.spend[module] ?? 0) + event.payload.usage.usd;
      }
      if (event.type === 'tool.completed' && event.payload.loaded) {
        state.loadedTools = mergeTools(state.loadedTools, event.payload.loaded);
      }
      if (event.type === 'tool.completed' && event.payload.handoff !== undefined && step?.skill) {
        step.handoff = event.payload.handoff;
        step.ended = true;
      }
      if (step?.tool && step.toolCallId === event.payload.toolCallId) {
        step.ended = true;
        step.toolOutcome = event.type === 'tool.completed' ? 'completed' : 'failed';
      }
      break;
    }
    case 'approval.requested':
      state.approvals[event.payload.requestId] = {
        request: event.payload,
        requestedAt: event.at,
        requestedSeq: event.seq,
        status: 'pending',
      };
      break;
    case 'approval.granted':
    case 'approval.denied':
      applyAnswer(state, event);
      break;
    case 'budget.raised':
      state.budget = { ...state.budget, ...event.payload.budget };
      break;
    case 'verify.result':
      if (!step) break;
      if (event.payload.verdict === 'retry') {
        step.verifyRetries += 1;
        step.ended = false;
        step.handoff = undefined;
        step.toldAt = state.transcript.length;
        state.transcript.push({ kind: 'control', text: `Check failed: ${event.payload.reason ?? ''}` });
      } else if (event.payload.verdict === 'fail') {
        step.status = 'failed';
      }
      break;
    case 'checkpoint.saved':
      if (step && step.status !== 'failed') step.status = 'done';
      break;
    case 'run.paused':
      state.status = 'paused';
      break;
    case 'run.resumed':
      state.status = 'running';
      break;
    case 'run.completed':
      state.status = 'completed';
      state.report = event.payload.report;
      break;
    case 'run.failed':
      state.status = 'failed';
      state.error = event.payload.error;
      break;
    case 'run.cancelled':
      state.status = 'cancelled';
      if (event.payload.reason) state.cancelReason = event.payload.reason;
      break;
    default:
      if (!applyPhase3Event(state, event)) applyFlowEvent(state, event, step);
  }
}

/** The model call id a flow's tool step logs its call under (no model turn asked for it). */
export const flowCallId = (stepId: string) => `flow:${stepId}`;

/** Requested tool calls with no outcome yet, in request order. */
export function openToolCalls(state: RunState): ToolCallState[] {
  return state.toolCallOrder.map((id) => state.toolCalls[id]!).filter((call) => !call.outcome);
}

export function pendingApprovals(state: RunState): ApprovalState[] {
  return Object.values(state.approvals).filter((a) => a.status === 'pending');
}

/** The newest approval of these kinds covering a tool call, if any. */
export function approvalFor(
  state: RunState,
  toolCallId: string,
  kind: ApprovalKind | readonly ApprovalKind[],
): ApprovalState | undefined {
  const kinds: readonly ApprovalKind[] = typeof kind === 'string' ? [kind] : kind;
  return Object.values(state.approvals)
    .filter((a) => kinds.includes(a.request.kind) && a.request.toolCallIds.includes(toolCallId))
    .at(-1);
}

function newStep(step: PlanStep): StepState {
  return { ...planStepOf(step), status: 'todo', turns: 0, verifyRetries: 0, ended: false, summary: '' };
}

/** A plan step's own fields (for plan events and cards), without the run's progress. */
export function planStepOf(step: PlanStep): PlanStep {
  return {
    id: step.id,
    text: step.text,
    ...(step.skill ? { skill: step.skill } : {}),
    ...(step.input !== undefined ? { input: step.input } : {}),
    ...(step.labelKey ? { labelKey: step.labelKey } : {}),
    ...(step.flow ? { flow: step.flow } : {}),
    ...(step.tool ? { tool: step.tool } : {}),
  };
}

/** AGT2: every tool loaded, newest last; the turn's offer keeps the newest its window allows (tool-offer.ts). */
function mergeTools(current: readonly string[], added: readonly string[]): string[] {
  return [...current.filter((t) => !added.includes(t)), ...added];
}

/** An approval's answer: its status, a model-budget allowance, a question's answer kept for the skill. */
function applyAnswer(
  state: RunState,
  event: Extract<AgentEvent, { type: 'approval.granted' | 'approval.denied' }>,
): void {
  const approval = state.approvals[event.payload.requestId];
  if (!approval) return;
  approval.status = event.type === 'approval.granted' ? 'granted' : 'denied';
  approval.answeredAt = event.at;
  if (event.type === 'approval.denied' && event.payload.reason) approval.deniedReason = event.payload.reason;
  // The project cap is checked again on resume: approving it lets nothing through by itself.
  if (
    approval.status === 'granted' &&
    approval.request.kind === 'budget' &&
    approval.request.limit !== 'projectCap' &&
    approval.request.toolCallIds.length === 0
  ) {
    state.modelBudgetAllowance += 1;
  }
  // A count answer (variants) is kept for the skill; Phase 3's question answers fold in state-phase3.ts.
  if (
    event.type === 'approval.granted' &&
    event.payload.answer?.kind === 'variants' &&
    approval.request.question
  )
    state.answers[approval.request.question] = event.payload.answer.count;
  applyPhase3Answer(state, approval.request.question, event, approval.requestedSeq);
}
