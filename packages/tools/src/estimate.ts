// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The estimate the budget gate sees for one call (round P3-3): the tool's synchronous `estimateCost` bound, or
 * its closer `refineCost` (which may read stored state: a timeline's draft characters, a song's length) when that
 * answers ok within REFINE_COST_TIMEOUT_MS under the call's signal. An error, a timeout or a cancelled call keeps
 * the bound, so a slow or broken refinement never stops a call and never lets one through unbudgeted.
 */
import type { AnyTool, ToolCostEstimate } from '@taalcut/core';

/** How long the gate waits for a closer estimate before it keeps the bound. */
export const REFINE_COST_TIMEOUT_MS = 2_000;

type Estimating = Pick<AnyTool, 'estimateCost' | 'refineCost'>;

/** The refinement's answer, or undefined as soon as `signal` aborts (the wait ran out or the call was cancelled). */
function refinedUnless(
  refine: () => ReturnType<NonNullable<Estimating['refineCost']>>,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof refine>> | undefined> {
  return new Promise((settle) => {
    const giveUp = () => settle(undefined);
    if (signal.aborted) {
      giveUp();
      return;
    }
    signal.addEventListener('abort', giveUp, { once: true });
    refine()
      // A refinement that throws is the tool's bug; the bound still gates the call.
      .then(settle, giveUp)
      .finally(() => signal.removeEventListener('abort', giveUp));
  });
}

export async function estimateFor(
  spec: Estimating,
  input: unknown,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<ToolCostEstimate | undefined> {
  const bound = spec.estimateCost?.(input);
  if (!spec.refineCost) return bound;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? REFINE_COST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const refine = spec.refineCost.bind(spec);
  const refined = await refinedUnless(() => refine(input, { signal }), signal);
  return refined?.ok ? refined.value : bound;
}
