// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Costs before paid work (SPEC section 14, G8): a skill step's estimate (its
 * model turns at the module's own price, plus its paid tools), the project
 * cap check, and the cheaper models that would fit. Estimates are logged with
 * `estimate.recorded` and settled with what the step really cost, so
 * `costAccuracy` can hold them to ±30%.
 */
import {
  newId,
  type AnySkill,
  type Billed,
  type ModelModuleId,
  type ProjectBudgetStore,
} from '@taalcut/core';
import { estimateUsd, type ModulePrice, type PriceLookup } from '@taalcut/models';
import type { CheaperChoice, EstimateLine } from './flow-events';
import type { RunLog, EventInput } from './run-log';

const CHARS_PER_TOKEN = 4;
/** A skill's model turns when it doesn't say (SkillSpec.limits.expectedTurns). */
export const DEFAULT_EXPECTED_TURNS = 4;
/** Cent-level rounding noise never trips the cap. */
const EPSILON_USD = 1e-9;

export interface CostDeps {
  readonly prices?: PriceLookup;
  readonly budgets?: ProjectBudgetStore;
}

export interface StepEstimate {
  readonly usd: number;
  readonly tokens: number;
  readonly lines: EstimateLine[];
}

const lineFor = (
  module: ModelModuleId,
  price: ModulePrice | undefined,
  tokens: number,
  usd: number,
  billed?: Billed,
): EstimateLine => ({
  module,
  provider: price?.provider ?? 'unknown',
  model: price?.model ?? 'unknown',
  local: price?.local ?? false,
  tokens,
  usd,
  ...(billed ? { billed } : {}),
});

/** Two lines' billed amounts together: only when both bill the same unit, else the line shows its tokens. */
function mergedBilled(a: EstimateLine, b: EstimateLine): Billed | undefined {
  if (!a.billed || !b.billed || a.billed.unit !== b.billed.unit) return undefined;
  return { unit: a.billed.unit, quantity: a.billed.quantity + b.billed.quantity };
}

/** The model turns of a skill step: expectedTurns × (prompt characters / 4 + expected output), at the module's price. */
export function modelTurnsLine(
  prices: PriceLookup | undefined,
  module: ModelModuleId,
  turns: number,
  promptChars: number,
  expectedOutputTokens: number,
): EstimateLine | undefined {
  const price = prices?.price(module);
  if (!price) return undefined;
  const inputTokens = turns * Math.ceil(promptChars / CHARS_PER_TOKEN);
  const outputTokens = turns * expectedOutputTokens;
  return lineFor(
    module,
    price,
    inputTokens + outputTokens,
    estimateUsd(price, { inputTokens, outputTokens }),
  );
}

/** One line per module: model turns and paid tools on the same module add up. */
export function mergeLines(lines: readonly EstimateLine[]): StepEstimate {
  const byModule = new Map<string, EstimateLine>();
  for (const line of lines) {
    const known = byModule.get(line.module);
    if (!known) {
      byModule.set(line.module, { ...line });
      continue;
    }
    const { billed: _replaced, ...rest } = known;
    const billed = mergedBilled(known, line);
    byModule.set(line.module, {
      ...rest,
      tokens: known.tokens + line.tokens,
      usd: known.usd + line.usd,
      ...(billed ? { billed } : {}),
    });
  }
  const merged = [...byModule.values()];
  return {
    usd: merged.reduce((sum, l) => sum + l.usd, 0),
    tokens: merged.reduce((sum, l) => sum + l.tokens, 0),
    lines: merged,
  };
}

/** A paid tool estimate's line: on the module its tools send to (vision for frame uploads), else the skill's. */
export function toolLine(
  prices: PriceLookup | undefined,
  module: ModelModuleId,
  estimate: { readonly usd: number; readonly tokens?: number; readonly billed?: Billed },
): EstimateLine {
  return lineFor(module, prices?.price(module), estimate.tokens ?? 0, estimate.usd, estimate.billed);
}

/** The first cloud module a skill's tools use, for its paid tools' line. */
export function paidModuleOf(
  skill: AnySkill,
  subset: readonly string[],
  cloudModules: (tool: string) => readonly string[] | undefined,
): ModelModuleId {
  for (const tool of subset) {
    const module = cloudModules(tool)?.[0];
    if (module) return module as ModelModuleId;
  }
  return skill.module ?? 'agent';
}

export type CapCheck =
  | { readonly over: false; readonly cap?: { usd: number; spentUsd: number } }
  | { readonly over: true; readonly cap: { usd: number; spentUsd: number } };

/** Would `usd` more take the project over its cap? A store that can't answer never blocks the user. */
export async function checkProjectCap(
  deps: CostDeps,
  projectId: string | undefined,
  usd: number,
): Promise<CapCheck> {
  if (!deps.budgets || !projectId) return { over: false };
  const budget = await deps.budgets.get(projectId as never);
  if (!budget.ok || budget.value.cap === null) return { over: false };
  const cap = { usd: budget.value.cap.micros / 1_000_000, spentUsd: budget.value.spent.micros / 1_000_000 };
  return usd > 0 && cap.spentUsd + usd > cap.usd + EPSILON_USD ? { over: true, cap } : { over: false, cap };
}

/** Models the user could switch to whose estimate for the same work fits what is left: this Mac first. */
export function cheaperChoices(
  prices: PriceLookup | undefined,
  module: ModelModuleId,
  tokens: { readonly inputTokens: number; readonly outputTokens: number },
  leftUsd: number,
): CheaperChoice[] {
  const current = prices?.price(module);
  return (prices?.options(module) ?? [])
    .filter((o) => !(o.provider === current?.provider && o.model === current.model))
    .map((o) => ({
      module,
      provider: o.provider,
      model: o.model,
      local: o.local,
      usd: o.local ? 0 : estimateUsd(o, tokens),
    }))
    .filter((o) => o.usd <= Math.max(0, leftUsd) + EPSILON_USD)
    .sort((a, b) => Number(b.local) - Number(a.local) || a.usd - b.usd)
    .slice(0, 5);
}

export interface CapRequest {
  readonly toolCallIds: string[];
  readonly projectId: string;
  readonly labelKey: string;
  readonly reason: string;
  readonly estimate: { usd: number; tokens: number };
  readonly cap: { usd: number; spentUsd: number };
  readonly cheaper: CheaperChoice[];
}

/** The budgetCap stop: an approval of kind budget with limit projectCap (the card is built from it). */
export function capApproval(request: CapRequest): { requestId: string; event: EventInput } {
  const requestId = newId<'Approval'>();
  return {
    requestId,
    event: [
      'approval.requested',
      {
        requestId,
        kind: 'budget',
        toolCallIds: request.toolCallIds,
        reason: request.reason,
        limit: 'projectCap',
        used: request.cap.spentUsd,
        max: request.cap.usd,
        estimate: request.estimate,
        projectId: request.projectId,
        labelKey: request.labelKey,
        cheaper: request.cheaper,
      },
    ],
  };
}

/** Pauses on the project cap before a model call or a skill step. */
export async function pauseAtCap(log: RunLog, request: CapRequest) {
  const { requestId, event } = capApproval(request);
  return log.append(event, ['run.paused', { reason: 'budget', requestIds: [requestId] }]);
}

/** What a step really cost: the run's usage since the step began. */
export function actualSince(
  usage: { readonly tokens: number; readonly usd: number },
  since: { readonly tokens: number; readonly usd: number } | undefined,
) {
  return { usd: usage.usd - (since?.usd ?? 0), tokens: usage.tokens - (since?.tokens ?? 0) };
}
