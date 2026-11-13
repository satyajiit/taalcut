// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2: what a searching step's prompt lists in its tool catalogue. Within the offer's `catalogue` (tool-offer.ts)
 * that is its whole subset, as before; past it, the ones nearest its route query, then its named tools in their
 * order, kept in the catalogue's own order, and a line saying findTools finds the rest. On the 4B at 8,192 the
 * Maker's 55 lines were 1,384 of its 6,391 first-turn tokens. Pure over the logged route query, so every turn of
 * the step, a resumed run and a replay list alike.
 */
import type { AnySkill } from '@taalcut/core';
import type { ToolCatalogueEntry } from '@taalcut/tools';
import type { RunContext } from './context';
import { subsetCatalogue } from './skill-step';

export interface StepCatalogue {
  readonly entries: ToolCatalogueEntry[];
  /** The subset's tools left out of the list (findTools finds them). */
  readonly more: number;
}

export function stepCatalogue(
  ctx: RunContext,
  skill: AnySkill,
  query: string,
  limit: number,
  withheld: ReadonlySet<string> = new Set(),
): StepCatalogue {
  const full = subsetCatalogue(ctx, skill, withheld);
  if (full.length <= limit) return { entries: full, more: 0 };
  const names = new Set(full.map((entry) => entry.name));
  const nearest = ctx.registry
    .search(query, { limit: Math.max(limit * 4, 40) })
    .map((hit) => hit.name)
    .filter((name) => names.has(name));
  const named = (skill.tools.names ?? []).filter((name) => names.has(name));
  const kept = new Set([...new Set([...nearest, ...named, ...names])].slice(0, limit));
  return { entries: full.filter((entry) => kept.has(entry.name)), more: full.length - kept.size };
}
