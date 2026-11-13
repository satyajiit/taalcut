// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A test ExternalRunner over the real ToolExecutor: what `packages/agent`'s runner does, reduced to what the gateway
 * relies on. Destructive, external and checkpoint calls ask the "person" (an approval desk the test drives), are
 * held up to `holdMs` with progress ticks, then answer pending; an approved call runs once under its approval.
 * Closing a run cancels its calls and expires its approvals.
 */
import {
  CancelledError,
  err,
  newId,
  ok,
  type AsyncResult,
  type CommandBus,
  type RunId,
  type ToolRunId,
} from '@taalcut/core';
import {
  createToolExecutor,
  type ExternalCallOutcome,
  type ExternalRunner,
  type ToolCommandBus,
  type ToolRegistry,
} from '@taalcut/tools';

type Decision = 'pending' | 'approved' | 'denied' | 'expired';

interface Approval {
  readonly id: string;
  readonly runId: RunId;
  readonly tool: string;
  decision: Decision;
  readonly waiters: Set<() => void>;
}

export interface ApprovalDesk {
  /** Every approval asked for so far, oldest first. */
  list(): readonly { id: string; tool: string; decision: Decision }[];
  decide(id: string, decision: 'approved' | 'denied'): void;
}

export interface TestRunner extends ExternalRunner {
  readonly desk: ApprovalDesk;
  /** Every executor call that started (de-duplicated ones too): domain state says what really ran. */
  readonly runs: string[];
  readonly closed: Set<RunId>;
}

/** Core's command bus as the executor's ToolCommandBus, keeping the call's origin. */
export function busAdapter(bus: CommandBus): ToolCommandBus {
  return {
    async dispatch(command, payload, meta) {
      const done = await bus.dispatch(
        command,
        payload,
        { source: meta.source, actor: meta.actor ?? `agent:${meta.runId ?? 'none'}` },
        meta.idempotencyKey ? { idempotencyKey: meta.idempotencyKey } : {},
      );
      return done.ok ? ok(done.value.result) : done;
    },
  };
}

export function createTestRunner(registry: ToolRegistry, bus: CommandBus): TestRunner {
  const approvals = new Map<string, Approval>();
  const byCall = new Map<string, Approval>();
  const callIds = new Map<string, ToolRunId>();
  const closed = new Set<RunId>();
  const inflight = new Map<RunId, Set<AbortController>>();
  const runs: string[] = [];

  const executor = createToolExecutor({
    registry,
    commands: busAdapter(bus),
    policy: {
      authorize(request) {
        if (!request.approvalRequired) return { kind: 'allow' };
        const approval = byCall.get(request.callId);
        return approval?.decision === 'approved'
          ? { kind: 'allow', approvalId: approval.id }
          : { kind: 'defer', reason: 'needs the person' };
      },
    },
    onEvent: (event) => {
      if (event.type === 'tool.started') runs.push(event.tool);
    },
  });

  const settle = (approval: Approval, decision: Decision): void => {
    approval.decision = decision;
    for (const wake of [...approval.waiters]) wake();
  };

  const wait = (approval: Approval, ms: number, signal: AbortSignal, tick: () => void): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      const ticker = setInterval(tick, Math.max(10, Math.floor(ms / 4)));
      function done(): void {
        clearTimeout(timer);
        clearInterval(ticker);
        approval.waiters.delete(done);
        signal.removeEventListener('abort', done);
        resolve();
      }
      approval.waiters.add(done);
      signal.addEventListener('abort', done, { once: true });
    });

  return {
    desk: {
      list: () => [...approvals.values()].map(({ id, tool, decision }) => ({ id, tool, decision })),
      decide(id, decision) {
        const approval = approvals.get(id);
        if (approval && approval.decision === 'pending') settle(approval, decision);
      },
    },
    runs,
    closed,
    async open() {
      return ok({ runId: newId<'AgentRun'>(), conversationId: newId<'Conversation'>() });
    },
    async call(runId, name, input, options): AsyncResult<ExternalCallOutcome> {
      if (closed.has(runId)) return err(CancelledError(undefined, { detail: 'run closed' }));
      const tool = registry.resolve(name);
      const callId = callIds.get(options.callKey) ?? newId<'ToolRun'>();
      callIds.set(options.callKey, callId);
      const controller = new AbortController();
      const forward = () => controller.abort();
      options.signal?.addEventListener('abort', forward, { once: true });
      const mine = inflight.get(runId) ?? new Set<AbortController>();
      mine.add(controller);
      inflight.set(runId, mine);
      try {
        const needsPerson =
          tool !== undefined && (tool.descriptor.requiresApproval || tool.descriptor.checkpoint);
        if (needsPerson) {
          let approval = byCall.get(callId);
          if (!approval || approval.decision === 'expired') {
            approval = {
              id: `approval-${approvals.size + 1}`,
              runId,
              tool: name,
              decision: 'pending',
              waiters: new Set(),
            };
            approvals.set(approval.id, approval);
            byCall.set(callId, approval);
          }
          if (approval.decision === 'pending') {
            await wait(approval, options.holdMs, controller.signal, () =>
              options.onProgress?.(null, 'Waiting for approval in Taalcut'),
            );
          }
          if (controller.signal.aborted) return err(CancelledError());
          if (approval.decision === 'denied') return ok({ kind: 'declined' });
          if (approval.decision !== 'approved') return ok({ kind: 'pending', approvalId: approval.id });
        }
        const result = await executor.execute(name, input, {
          callId,
          runId,
          scope: runId,
          origin: options.origin,
          signal: controller.signal,
        });
        return result.ok ? ok({ kind: 'done', result: result.value }) : result;
      } finally {
        mine.delete(controller);
        options.signal?.removeEventListener('abort', forward);
      }
    },
    async close(runId) {
      closed.add(runId);
      for (const controller of inflight.get(runId) ?? []) controller.abort();
      for (const approval of approvals.values()) {
        if (approval.runId === runId && approval.decision === 'pending') settle(approval, 'expired');
      }
      return ok(undefined);
    },
  };
}
