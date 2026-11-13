// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A selected schema may take one turn's room; discovery always offers a way back to controls. */
import type { RunContext } from '../context';
import type { TurnContext } from '../turn-context';
import type { ToolSpec } from '@taalcut/models';

export function selectedOffer(turn: TurnContext, controls: readonly ToolSpec[]): TurnContext {
  const names = controls.filter((tool) => tool.name !== 'findTools').map((tool) => JSON.stringify(tool.name));
  const note =
    '\n\nYou need not perform the action. Restore controls with ' +
    `findTools(query: ${names.join(' / ')}), or discover another permitted tool.`;
  return { ...turn, system: turn.system + note };
}

/** Folded request names survive replay and distinguish this fallback from ordinary domain failures. */
export function wasSelectedOffer(ctx: RunContext): boolean {
  const names = ctx.log.state.plan?.[ctx.log.state.stepIndex]?.lastToolNames;
  return (
    names?.length === 2 && names.includes('findTools') && names.some((name) => ctx.registry.resolve(name))
  );
}
