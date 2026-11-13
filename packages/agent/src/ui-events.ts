// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Turns logged events into card payloads and run-status events for the UI. */
import type { AgentUiEvent } from './cards';
import { consentOptions } from './chat-cards';
import type { AgentEvent } from './events';
import type { RunState } from './state';

export function uiEventsFor(event: AgentEvent, state: RunState): AgentUiEvent[] {
  const runId = state.runId;
  switch (event.type) {
    case 'plan.created':
    case 'plan.updated':
    case 'step.started':
    case 'checkpoint.saved':
      return [
        {
          type: 'agent.card',
          card: {
            kind: 'plan',
            runId,
            steps: (state.plan ?? []).map((s) => ({ id: s.id, text: s.text, status: s.status })),
          },
        },
      ];
    case 'approval.requested': {
      const p = event.payload;
      if (p.kind === 'budget') {
        return [
          {
            type: 'agent.card',
            card: {
              kind: 'costEstimate',
              runId,
              requestId: p.requestId,
              limit: p.limit ?? 'usd',
              used: p.used ?? 0,
              max: p.max ?? 0,
              estimate: p.estimate ?? { usd: 0, tokens: 0 },
              options: ['approve-once', 'raise-budget', 'stop'],
            },
          },
        ];
      }
      if (p.kind === 'consent') {
        // A reference, a standing consent or Local only answered it at once: logged, and the tool-run card shows it.
        const call = state.toolCalls[p.toolCallIds[0] ?? ''];
        if (p.standingConsentIds || p.localOnly || p.reference || p.missingFiles || !call || !p.upload)
          return [];
        return [
          {
            type: 'agent.card',
            card: {
              kind: 'consent',
              runId,
              requestId: p.requestId,
              toolCallId: call.requested.toolCallId,
              tool: call.requested.tool,
              input: call.requested.input,
              upload: p.upload,
              ...(p.estimate ? { estimate: p.estimate } : {}),
              options: consentOptions(p),
            },
          },
        ];
      }
      const calls = p.toolCallIds.flatMap((id) => {
        const call = state.toolCalls[id];
        return call
          ? [
              {
                toolCallId: id,
                tool: call.requested.tool,
                sideEffect: call.requested.sideEffect,
                input: call.requested.input,
              },
            ]
          : [];
      });
      return [{ type: 'agent.card', card: { kind: 'approval', runId, requestId: p.requestId, calls } }];
    }
    case 'tool.requested':
      return event.payload.meta ? [] : [toolRun(state, event.payload.toolCallId, 'running')];
    case 'tool.completed':
    case 'tool.failed': {
      const call = state.toolCalls[event.payload.toolCallId];
      if (!call || call.requested.meta) return [];
      return [
        event.type === 'tool.completed'
          ? toolRun(state, call.requested.toolCallId, 'done', {
              cached: event.payload.cached,
              ...(event.payload.summary ? { summary: event.payload.summary } : {}),
            })
          : toolRun(state, call.requested.toolCallId, 'failed', { errorCode: event.payload.error.code }),
      ];
    }
    case 'run.paused':
      return [
        { type: 'agent.run.status', runId, status: 'paused' },
        ...Object.values(state.toolCalls)
          .filter((c) => !c.outcome && !c.requested.meta)
          .map((c) => toolRun(state, c.requested.toolCallId, 'awaiting-approval')),
      ];
    case 'run.resumed':
      return [{ type: 'agent.run.status', runId, status: 'running' }];
    case 'run.completed':
      return [{ type: 'agent.run.status', runId, status: 'completed', report: event.payload.report }];
    case 'run.cancelled':
      return [{ type: 'agent.run.status', runId, status: 'cancelled' }];
    case 'run.failed':
      return [
        { type: 'agent.card', card: { kind: 'error', runId, error: event.payload.error } },
        { type: 'agent.run.status', runId, status: 'failed' },
      ];
    default:
      return [];
  }
}

function toolRun(
  state: RunState,
  toolCallId: string,
  status: 'running' | 'done' | 'failed' | 'awaiting-approval',
  extra: { cached?: boolean; errorCode?: string; summary?: string } = {},
): AgentUiEvent {
  const tool = state.toolCalls[toolCallId]?.requested.tool ?? '';
  return {
    type: 'agent.card',
    card: { kind: 'toolRun', runId: state.runId, toolCallId, tool, status, ...extra },
  };
}
