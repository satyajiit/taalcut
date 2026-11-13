// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Turns a run's log (and, live, its streamed deltas) into the `agent.*`
 * events the chat shows. One translator per run, fed in log order: the same
 * log gives the same events, so history and the live stream match. Meta tools
 * (plan, tool search, artifact reads, handOff, askUser, startFlow) don't show
 * as tool runs; the plan shows as the plan card. Reasoning comes live from the
 * stream and, in history, from the reasoning parts of each logged model
 * message, cut at REASONING_LIMIT characters per message either way. An upload
 * asks with core's consent card; a tool with its own approval card (the export)
 * asks with that card; a skill's question with the skill's card in its asking
 * state; the project cap with the budgetCap card; other steps with
 * `agent.approvalRequested`. Cards the agent computed are logged whole.
 */
import type { Card, MessageId, RunId, TaalcutError, ToolRunId } from '@taalcut/core';
import { toolCallSummary } from '@taalcut/core';
import type { AgentUiEvent } from './cards';
import {
  answeredCard,
  budgetCapCard,
  consentCard,
  exportedCard,
  runBudgetCard,
  stepCostCard,
} from './chat-cards';
import { RunStart } from './chat-run-start';
import type { ChatEvent } from './chat-types';
import type { AgentEvent, BudgetLimit, EventPayloads, PlanStep } from './events';

type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
type Changing = 'write' | 'destructive' | 'external';
type Asked = EventPayloads['approval.requested'];
type Approval = { request: Asked; tool: string; sideEffect: Changing; summary: string };
type ShownStep = { id: string; text: string; status: PlanStepStatus; skill?: string; labelKey?: string };

const BUDGET: Record<BudgetLimit, 'tokens' | 'money' | 'time'> = {
  tokens: 'tokens',
  usd: 'money',
  wallClock: 'time',
  projectCap: 'money',
};
/** Reasoning the chat shows per model message, in characters. The log keeps all of it. */
export const REASONING_LIMIT = 8_000;
const CUT = ' […]';

/** Money goes to the UI in micro-USD. */
const units = (limit: BudgetLimit, amount: number) =>
  limit === 'usd' || limit === 'projectCap' ? Math.round(amount * 1_000_000) : amount;

const shown = (s: PlanStep, status: PlanStepStatus): ShownStep => ({
  id: s.id,
  text: s.text,
  status,
  ...(s.skill ? { skill: s.skill } : {}),
  ...(s.labelKey ? { labelKey: s.labelKey } : {}),
});

export class RunTranslator {
  /** What run.started said: every agent.runStarted carries its effort and pointers (resumes too). */
  private readonly start = new RunStart();
  private steps: ShownStep[] = [];
  private readonly tools = new Map<
    string,
    EventPayloads['tool.requested'] & { held?: boolean; startedAt?: number }
  >();
  private readonly texts = new Map<string, string>();
  private readonly approvals = new Map<string, Approval>();
  /** Cards logged with an approval (the tool's own decision card), by approval id. */
  private readonly approvalCards = new Map<string, Card>();
  private readonly estimates = new Map<string, EventPayloads['estimate.recorded']>();
  /** Model calls whose text already went out as live deltas. */
  private readonly streamed = new Set<string>();
  /** Reasoning characters sent so far, per model call. */
  private readonly reasoned = new Map<string, number>();

  constructor(
    readonly runId: RunId,
    private readonly now: () => number = Date.now,
  ) {}

  /** Live text and reasoning, as the model writes them. */
  delta(event: AgentUiEvent): ChatEvent[] {
    if (event.type === 'agent.text.delta') {
      this.streamed.add(event.modelCallId);
      return [
        this.event('agent.messageDelta', this.now(), {
          runId: this.runId,
          messageId: event.modelCallId as MessageId,
          delta: event.delta,
        }),
      ];
    }
    if (event.type === 'agent.reasoning.delta')
      return this.reasoning(event.modelCallId, event.delta, this.now());
    return [];
  }

  /** From the run's run.started. */
  get conversationId() {
    return this.start.conversationId;
  }

  /** One logged event. */
  logged(event: AgentEvent): ChatEvent[] {
    const runId = this.runId;
    const at = event.at;
    switch (event.type) {
      case 'run.started':
        this.start.read(event.payload);
        return [this.event('agent.runStarted', at, this.start.payload(runId))];
      case 'run.resumed':
        return [this.event('agent.runStarted', at, this.start.payload(runId))];
      case 'flow.started':
        this.start.projectId = event.payload.projectId ?? this.start.projectId;
        return [];
      case 'plan.created':
      case 'plan.updated':
        return this.plan(event.type === 'plan.created', event.payload, at);
      case 'step.started':
        return this.step(event.payload.stepId, 'running', at);
      case 'checkpoint.saved':
        return this.step(event.payload.stepId, 'done', at);
      case 'step.skipped':
        return this.step(event.payload.stepId, 'skipped', at);
      case 'verify.result':
        return event.payload.verdict === 'fail' ? this.step(event.payload.stepId, 'failed', at) : [];
      case 'model.responded':
        return this.responded(event.payload, at);
      case 'tool.requested':
        return this.requested(event.payload, at);
      case 'tool.completed':
      case 'tool.failed':
        return this.finished(event, at);
      case 'approval.requested':
        return this.asked(event.payload, at);
      case 'approval.granted':
      case 'approval.denied':
        return this.answered(event, at);
      case 'card.sent':
        if (event.payload.approvalId) this.approvalCards.set(event.payload.approvalId, event.payload.card);
        return [this.event('agent.card', at, { runId, card: event.payload.card })];
      case 'estimate.recorded':
        this.estimates.set(event.payload.estimateId, event.payload);
        return [
          this.event('agent.card', at, {
            runId,
            card: stepCostCard(runId, this.start.projectId, event.payload),
          }),
        ];
      case 'estimate.settled': {
        const recorded = this.estimates.get(event.payload.estimateId);
        if (!recorded) return [];
        const card = stepCostCard(runId, this.start.projectId, recorded, event.payload.actual);
        return [this.event('agent.card', at, { runId, card })];
      }
      case 'run.paused':
        return [this.event('agent.runFinished', at, { runId, status: 'paused' })];
      case 'run.completed':
        return [this.event('agent.runFinished', at, { runId, status: 'succeeded' })];
      case 'run.failed':
        return [
          this.event('agent.runFinished', at, {
            runId,
            status: 'failed',
            error: event.payload.error as TaalcutError,
          }),
        ];
      case 'run.cancelled':
        return [this.event('agent.runFinished', at, { runId, status: 'cancelled' })];
      default:
        return [];
    }
  }

  /** The plan as the fold keeps it: known steps stay in place, new ones go after `insertAfter` or at the end. */
  private plan(created: boolean, p: EventPayloads['plan.updated'], at: number): ChatEvent[] {
    const added: ShownStep[] = [];
    for (const s of p.steps) {
      const known = created ? undefined : this.steps.find((old) => old.id === s.id);
      if (known) known.text = s.text;
      else added.push(shown(s, 'pending'));
    }
    if (created) this.steps = added;
    else {
      const index = p.insertAfter === undefined ? -1 : this.steps.findIndex((s) => s.id === p.insertAfter);
      if (index >= 0) this.steps.splice(index + 1, 0, ...added);
      else this.steps.push(...added);
    }
    return [this.event('agent.plan', at, { runId: this.runId, steps: this.steps.map((s) => ({ ...s })) })];
  }

  private responded(p: EventPayloads['model.responded'], at: number): ChatEvent[] {
    const { modelCallId, text, message } = p;
    this.texts.set(modelCallId, text);
    const thought = this.reasoned.has(modelCallId)
      ? ''
      : message.parts.flatMap((part) => (part.type === 'reasoning' ? [part.text] : [])).join('');
    const said = text && !this.streamed.has(modelCallId);
    const delta = { runId: this.runId, messageId: modelCallId as MessageId, delta: text };
    return [
      ...(thought ? this.reasoning(modelCallId, thought, at) : []),
      ...(said ? [this.event('agent.messageDelta', at, delta)] : []),
    ];
  }

  /**
   * A tool with its own approval and result cards (an export) shows those cards instead of its row
   * (the row only if no result card comes). A tool with only a result card shows its row, then the card.
   */
  private requested(p: EventPayloads['tool.requested'], at: number): ChatEvent[] {
    const held = Boolean(p.cards?.approval && p.cards.result);
    this.tools.set(p.toolCallId, { ...p, held, startedAt: at });
    if (p.meta || held) return [];
    return [this.toolStarted(p, at)];
  }

  private toolStarted(p: EventPayloads['tool.requested'], at: number): ChatEvent {
    return this.event('agent.toolStarted', at, {
      runId: this.runId,
      toolRunId: p.toolCallId,
      tool: p.tool,
      sideEffect: p.sideEffect,
    });
  }

  private finished(
    event: Extract<AgentEvent, { type: 'tool.completed' | 'tool.failed' }>,
    at: number,
  ): ChatEvent[] {
    const call = this.tools.get(event.payload.toolCallId);
    if (!call || call.meta) return [];
    const exported = this.exported(event, at);
    if (call.held && event.type === 'tool.completed' && event.payload.resultCard) return exported;
    const error = event.type === 'tool.failed' ? event.payload.error : undefined;
    const stopped = error && (error.code === 'core.cancelled' || error.code === 'tools.denied');
    // Bounded again: a log written by another build may hold a longer line, and the event's schema refuses it.
    const summary = event.type === 'tool.completed' ? toolCallSummary(event.payload.summary) : undefined;
    return [
      ...(call.held ? [this.toolStarted(call, call.startedAt ?? at)] : []),
      this.event('agent.toolFinished', at, {
        runId: this.runId,
        toolRunId: event.payload.toolCallId,
        tool: call.tool,
        status: !error ? 'succeeded' : stopped ? 'cancelled' : 'failed',
        durationMs: event.payload.durationMs,
        ...(error && !stopped ? { error } : {}),
        ...(summary ? { summary } : {}),
      }),
      ...exported,
    ];
  }

  /** An approved export finished: its card shows the render. */
  private exported(
    event: Extract<AgentEvent, { type: 'tool.completed' | 'tool.failed' }>,
    at: number,
  ): ChatEvent[] {
    if (event.type !== 'tool.completed' || !event.payload.approvalId) return [];
    const card = this.approvalCards.get(event.payload.approvalId);
    const output = event.payload.output.kind === 'inline' ? event.payload.output.value : undefined;
    const done = card ? exportedCard(card, output) : undefined;
    return done ? [this.event('agent.card', at, { runId: this.runId, card: done })] : [];
  }

  /** Reasoning for one model call, up to REASONING_LIMIT characters in all. */
  private reasoning(modelCallId: string, text: string, at: number): ChatEvent[] {
    const sent = this.reasoned.get(modelCallId) ?? 0;
    const room = REASONING_LIMIT - sent;
    if (room <= 0 || !text) return [];
    this.reasoned.set(modelCallId, text.length < room ? sent + text.length : REASONING_LIMIT);
    const delta = text.length > room ? `${text.slice(0, room)}${CUT}` : text;
    return [{ type: 'agent.reasoningDelta', at, payload: { runId: this.runId, delta } }];
  }

  private step(stepId: string, status: PlanStepStatus, at: number): ChatEvent[] {
    const step = this.steps.find((s) => s.id === stepId);
    if (step) step.status = status;
    return [this.event('agent.step', at, { runId: this.runId, stepId, status })];
  }

  private asked(p: Asked, at: number): ChatEvent[] {
    const runId = this.runId;
    const first = p.toolCallIds[0];
    const call = first ? this.tools.get(first) : undefined;
    // A question and a tool's own decision card arrive as card.sent.
    if (p.kind === 'question' || p.customCard) {
      this.approvals.set(p.requestId, {
        request: p,
        tool: call?.tool ?? '',
        sideEffect: 'write',
        summary: '',
      });
      return [];
    }
    if (p.kind === 'budget') {
      const limit = p.limit ?? 'usd';
      this.approvals.set(p.requestId, {
        request: p,
        tool: call?.tool ?? '',
        sideEffect: 'write',
        summary: '',
      });
      const card =
        limit === 'projectCap'
          ? budgetCapCard(runId, p, 'pending', this.start.requester)
          : runBudgetCard(runId, p.requestId, p, true);
      return [
        this.event('agent.budgetExceeded', at, {
          runId,
          budget: BUDGET[limit],
          limit: units(limit, p.max ?? 0),
          used: units(limit, p.used ?? 0),
        }),
        this.event('agent.card', at, { runId, card }),
      ];
    }
    // A reference's frames, a standing upload consent, Local only or missing files answered it at once: logged, not asked.
    if (p.standingConsentIds || p.localOnly || p.reference || p.missingFiles || !call) return [];
    if (p.kind === 'consent' && p.upload && p.upload.modules.length > 0) {
      this.approvals.set(p.requestId, { request: p, tool: call.tool, sideEffect: 'external', summary: '' });
      const card = consentCard(runId, p, call.tool, 'pending', this.start.requester);
      return [this.event('agent.card', at, { runId, card })];
    }
    const approval: Approval = {
      request: p,
      tool: call.tool,
      sideEffect: call.sideEffect === 'read' ? 'write' : call.sideEffect,
      // The model's own words for the turn that asked for the call; the tool's name if it said nothing.
      summary: this.texts.get(call.modelCallId)?.trim() || call.tool,
    };
    this.approvals.set(p.requestId, approval);
    const { tool, sideEffect, summary: reason } = approval;
    return [
      this.event('agent.approvalRequested', at, {
        runId,
        approvalId: p.requestId,
        toolRunId: first as ToolRunId,
        tool,
        sideEffect,
        reason,
      }),
    ];
  }

  private answered(
    event: Extract<AgentEvent, { type: 'approval.granted' | 'approval.denied' }>,
    at: number,
  ): ChatEvent[] {
    const { requestId } = event.payload;
    const granted = event.type === 'approval.granted';
    const approval = this.approvals.get(requestId);
    if (!approval) return [];
    const runId = this.runId;
    const { request } = approval;
    const shownCard = this.approvalCards.get(requestId);
    if (request.kind === 'question') return [];
    if (request.customCard && shownCard) {
      const stale = event.type === 'approval.denied' && event.payload.reason === 'stale';
      const card = answeredCard(shownCard, granted, stale);
      return card ? [this.event('agent.card', at, { runId, card })] : [];
    }
    if (request.kind === 'budget') {
      const card =
        request.limit === 'projectCap'
          ? budgetCapCard(runId, request, granted ? 'raised' : 'stopped', this.start.requester)
          : runBudgetCard(runId, requestId, request, false);
      return [this.event('agent.card', at, { runId, card })];
    }
    if (request.kind === 'consent' && request.upload) {
      const status = granted ? 'approved' : 'denied';
      const card = consentCard(runId, request, approval.tool, status, this.start.requester);
      return [this.event('agent.card', at, { runId, card })];
    }
    const card = {
      type: 'approval' as const,
      id: requestId,
      version: 1 as const,
      runId,
      approvalId: requestId,
      tool: approval.tool,
      sideEffect: approval.sideEffect,
      summary: approval.summary,
      status: granted ? ('approved' as const) : ('denied' as const),
    };
    return [this.event('agent.card', at, { runId, card })];
  }

  private event<T extends ChatEvent['type']>(
    type: T,
    at: number,
    payload: Extract<ChatEvent, { type: T }>['payload'],
  ): ChatEvent {
    return { type, at, payload } as ChatEvent;
  }
}
