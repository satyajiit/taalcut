// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Usage and the agent's traces over the stores that keep them
 * (UsageStore, TraceStore; the library implements both). Apart from the
 * contracts so the ports can use the contracts' types.
 */
import { implementContract } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import { latestValues } from '../ipc/iterators';
import { callOptional, notServed } from '../ipc/not-served';
import type { TraceStore, UsageStore } from '../ports/observability';
import type { UsageLimits } from './usage-summary';
import { tracesContract } from './traces-contract';
import { usageContract } from './usage-contract';

/** `limits`: the models client's tracker (G8); absent until it lands, when the limit procedures answer not-implemented. */
export function usageRouter(usage: UsageStore, limits?: UsageLimits) {
  const os = implementContract(usageContract);
  return os.router({
    list: os.list.handler(async ({ input }) => unwrapRpc(await usage.list(input))),
    summary: os.summary.handler(({ input }) =>
      callOptional('usage.summary', usage.summary?.bind(usage), input),
    ),
    limits: os.limits.handler(limits ? () => [...limits.current()] : notServed('usage.limits')),
    limitsChanged: os.limitsChanged.handler(
      limits
        ? ({ signal }) =>
            latestValues(
              () => [...limits.current()],
              (listener) => limits.subscribe((next) => listener([...next])),
              signal,
            )
        : notServed('usage.limits'),
    ),
  });
}

export function tracesRouter(traces: TraceStore) {
  const os = implementContract(tracesContract);
  return os.router({
    runs: os.runs.handler(async ({ input }) => unwrapRpc(await traces.runs(input))),
    get: os.get.handler(async ({ input }) => unwrapRpc(await traces.get(input))),
  });
}
