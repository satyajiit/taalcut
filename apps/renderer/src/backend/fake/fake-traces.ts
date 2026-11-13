// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { RunId, TaalcutError, Trace, TraceSummary } from '@taalcut/core';

const tokensOf = (s: Trace['spans'][number]) =>
  (s.inputTokens ?? 0) + (s.cachedInputTokens ?? 0) + (s.outputTokens ?? 0);

/** The list row for each run, newest first, with totals over its model and tool spans. */
export function summarizeTraces(traces: readonly Trace[]): TraceSummary[] {
  return [...traces]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((trace) => {
      const models = trace.spans.filter((s) => s.kind === 'model');
      const tools = trace.spans.filter((s) => s.kind === 'tool');
      const priced = [...models, ...tools];
      return {
        runId: trace.runId,
        conversationId: trace.conversationId,
        status: trace.status,
        message: trace.message,
        startedAt: trace.startedAt,
        ...(trace.endedAt !== undefined ? { endedAt: trace.endedAt } : {}),
        modelCalls: models.length,
        toolCalls: tools.length,
        tokens: priced.reduce((n, s) => n + tokensOf(s), 0),
        costUsd: priced.reduce((n, s) => n + (s.costUsd ?? 0), 0),
        cacheHits: tools.filter((s) => s.cacheHit).length,
        complete: trace.gaps.length === 0,
      };
    });
}

export function findTrace(traces: readonly Trace[], runId: RunId): Trace | TaalcutError {
  return (
    traces.find((t) => t.runId === runId) ?? {
      code: 'core.not_found',
      messageKey: 'errors.core.not_found',
      params: { entity: 'run', id: runId },
      retryable: false,
    }
  );
}
