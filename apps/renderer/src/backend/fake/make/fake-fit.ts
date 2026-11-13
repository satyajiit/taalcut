// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-TPL: timelines.fitTemplates over the fake's saved templates. The fake has no shot vectors, so a pool's fit
 * is made up but steady: each template in scope (listed, unarchived, by default) gets how many of its slots the pool
 * fills and how well from a generator seeded by the pool and its id, its unfilled slots named by their intents, and
 * the fits come back best first as the real service ranks them (fit score, coverage, hook, id).
 *
 * Scenario (`fit` in taalcut.fake, options/fit.ts): 'noShots' (no clip of the pool has a vector yet: every template
 * scored, none filled) or 'failing' (every read times out, as an agent that doesn't answer).
 */
import {
  appContract,
  implementContract,
  TimeoutError,
  toRpcError,
  type AnyCommand,
  type FitPool,
  type FitTemplateScope,
  type FitWeakReason,
  type Template,
  type TemplateFit,
  type TemplateSummary,
} from '@taalcut/core';
import { prng } from '../library/seed';
import type { MakeP3Deps } from './p3/deps';

export type FitScenario = 'noShots' | 'failing';

/** The fit area's scenario from whatever the store held under `fit`; anything else is the default. */
export const readFitScenario = (value: unknown): FitScenario | null =>
  value === 'noShots' || value === 'failing' ? value : null;

const PROCEDURES = { fitTemplates: appContract.timelines.fitTemplates };
const REASONS: readonly FitWeakReason[] = ['noShot', 'orientation', 'taken'];
const MAX_WEAK = 200;

/** A generator seeded by the text, so the same pool and template always fit the same way. */
const drawsFor = (text: string) =>
  prng([...text].reduce((seed, char) => (Math.imul(seed, 31) + char.charCodeAt(0)) >>> 0, 17));

const round = (value: number) => Math.round(value * 1000) / 1000;

function inScope(summary: TemplateSummary, scope: FitTemplateScope): boolean {
  if (scope.templateIds) return scope.templateIds.includes(summary.id);
  if (!summary.listed || summary.archived) return false;
  if (scope.folderId && summary.folderId !== scope.folderId) return false;
  return !scope.tags || scope.tags.every((tag) => summary.tags.includes(tag));
}

/** How the pool fills one template: most slots, often all of them; the short ones say why. */
function fitOf(summary: TemplateSummary, head: Template, poolKey: string, poolShots: number): TemplateFit {
  const slots = head.slots.length;
  const draw = drawsFor(`${poolKey}|${summary.id}`);
  const short = poolShots === 0 ? slots : Math.min(slots, Math.floor(draw() * 4));
  const covered = slots - short;
  // The unfilled slots: the last ones of a steady shuffle, reported in slot order.
  const order = head.slots.map((slot, index) => ({ slot, index, at: draw() })).sort((a, b) => a.at - b.at);
  const weak = order
    .slice(covered)
    .sort((a, b) => a.index - b.index)
    .slice(0, MAX_WEAK);
  const opens = covered > 0 && !weak.some((item) => item.index === 0);
  return {
    summary,
    version: head.version,
    slots,
    covered,
    coverage: round(covered / slots),
    meanScore: covered > 0 ? round(0.52 + draw() * 0.38) : null,
    hook: opens ? round(0.35 + draw() * 0.6) : null,
    weakSlots: weak.map(({ slot, index }) => ({
      slotId: slot.id,
      index,
      intent: slot.intent.text,
      shotType: slot.intent.shotType,
      reason: poolShots === 0 ? 'noShot' : (REASONS[Math.floor(draw() * REASONS.length)] ?? 'noShot'),
    })),
  };
}

/** The fit score the real service ranks by: the mean score over every slot, a short slot scoring 0. */
const fitScore = (fit: TemplateFit) =>
  fit.meanScore === null ? -1 : (fit.meanScore * fit.covered) / fit.slots;

const rank = (a: TemplateFit, b: TemplateFit) =>
  fitScore(b) - fitScore(a) ||
  b.coverage - a.coverage ||
  (b.hook ?? -1) - (a.hook ?? -1) ||
  a.summary.id.localeCompare(b.summary.id);

/** Clips in the pool with a vector: a source holds 24 to 120 of them. */
function poolShotsOf(pool: FitPool, poolKey: string): number {
  const sources = pool.sourceIds?.length ?? 0;
  const assets = pool.assetIds?.length ?? 0;
  const window = pool.capturedFrom !== undefined || pool.capturedTo !== undefined ? 1 : 0;
  return Math.min(2000, (sources + window) * (24 + Math.floor(drawsFor(poolKey)() * 96)) + assets * 3);
}

export function createFakeFit(deps: Pick<MakeP3Deps, 'templates' | 'options'>) {
  const os = implementContract(PROCEDURES);
  const scenario = readFitScenario(deps.options.areas?.['fit']);
  const latency = deps.options.latencyMs ?? 0;
  const router = {
    fitTemplates: os.fitTemplates.handler(async ({ input }) => {
      if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
      if (scenario === 'failing') throw toRpcError(TimeoutError({ ms: 60_000 }));
      const poolKey = JSON.stringify(input.pool);
      const poolShots = scenario === 'noShots' ? 0 : poolShotsOf(input.pool, poolKey);
      const fits: TemplateFit[] = [];
      for (const summary of deps.templates.summaries()) {
        const head = inScope(summary, input.templates) ? deps.templates.template(summary.id) : null;
        if (head) fits.push(fitOf(summary, head, poolKey, poolShots));
      }
      return {
        configVersion: 'casting.v1',
        poolShots,
        poolTruncated: false,
        templates: fits.length,
        fits: fits.sort(rank).slice(0, input.limit),
      };
    }),
  };
  const commands: AnyCommand[] = [];
  return { router, commands };
}
