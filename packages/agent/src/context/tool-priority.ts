// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A bounded offer keeps the latest requested tools before the step's original route ranking. When that offer
 * leaves out the tool the step has to call next, fit.ts asks for the finishing order instead.
 */
import type { ToolSpec } from '@taalcut/models';
import type { RunContext } from '../context';
import { META_TOOLS } from '../meta-tools';
import { SKILL_META_TOOLS } from '../skill-tools';
import { queriedMetaTools } from '../find-tools';
import { specOf } from '../turn-context';
import { handoffNeeds } from './handoff-needs';

const META = new Set([...META_TOOLS, ...SKILL_META_TOOLS]);

/** Where `name` stands in `text` as a whole tool name ("render.draft revision 2, then video.done."), or -1. */
function namedAt(text: string, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w.])${escaped}(?![\\w]|\\.\\w)`).exec(text)?.index ?? -1;
}

/**
 * The tools a step has to call next, first to last, as specs a request can offer.
 *
 * - The tools its latest failed check or corrective note names (StepState.toldAt), less the ones completed since. A
 *   note that names a tool the model is not offered is a dead end: 0.1.0's installed run (Qwen3.5 4B at
 *   12,288 tokens) was told "render.draft revision 2, then video.done" while its offer held three library tools,
 *   and could only hand off again until the retries ran out. They are read from the registry, since the newest
 *   loaded tools may no longer include them.
 * - Once the step has completed a tool, the one tool that returns the most of what its handoff still lacks, when
 *   there is exactly one (handoff-needs.ts). In the same run the offer after timeline.cast kept cast and two
 *   cheaper tools and left out timeline.assemble, and the model handed off ids it made up. Several such tools (the
 *   Maker's handoff is what any edit returns) say nothing about which comes next, so the route's order stands.
 */
export function finishingTools(ctx: RunContext): ToolSpec[] {
  const state = ctx.log.state;
  const step = state.plan?.[state.stepIndex];
  if (!step?.skill) return [];
  const needs = handoffNeeds(ctx, step);
  const named: string[] = [];
  const note = step.toldAt === undefined ? undefined : state.transcript[step.toldAt];
  if (note?.kind === 'control' && step.toldAt !== undefined) {
    const since = new Set(
      state.transcript
        .slice(step.toldAt + 1)
        .flatMap((item) => (item.kind === 'assistant' ? item.toolCallIds : []))
        .map((id) => state.toolCalls[id])
        .filter((call) => call?.outcome?.kind === 'completed')
        .map((call) => call?.requested.tool),
    );
    const places = needs.tools.map((name) => [name, namedAt(note.text, name)] as const);
    named.push(
      ...places
        .filter(([name, at]) => at >= 0 && !since.has(name))
        .sort((a, b) => a[1] - b[1])
        .map(([name]) => name),
    );
  }
  const completed = new Set(
    needs.calls
      .filter((call) => !call.requested.meta && call.outcome?.kind === 'completed')
      .map((call) => call.requested.tool),
  );
  const [giver] = needs.givers;
  const sole =
    completed.size > 0 && needs.givers.length === 1 && giver && !completed.has(giver) ? [giver] : [];
  return [...new Set([...named, ...sole])].flatMap((name) => {
    const tool = ctx.registry.resolve(name);
    return tool ? [specOf(tool)] : [];
  });
}

/** With `finishing`, those tools lead the ranking: the order fit.ts tries when the route's order left the first out. */
export function prioritisedTools(
  ctx: RunContext,
  tools: readonly ToolSpec[],
  finishing: readonly ToolSpec[] = [],
) {
  const state = ctx.log.state;
  const recent = state.transcript
    .filter((item) => item.step === state.stepIndex && item.kind === 'assistant')
    .flatMap((item) => (item.kind === 'assistant' ? item.toolCallIds : []))
    .map((id) => state.toolCalls[id])
    .findLast((call) => call?.requested.tool === 'findTools' && call.outcome?.kind === 'completed');
  const loaded = recent?.outcome?.kind === 'completed' ? (recent.outcome.payload.loaded ?? []) : [];
  const input = recent?.requested.input;
  const query = input && typeof input === 'object' && 'query' in input ? input.query : undefined;
  const requestedMeta =
    loaded.length === 0 &&
    typeof query === 'string' &&
    queriedMetaTools(query).some((name) => tools.some((tool) => META.has(tool.name) && tool.name === name));
  const routed = state.plan?.[state.stepIndex]?.routedTools ?? [];
  const latest = state.transcript.at(-1);
  const specs = (names: readonly string[]) =>
    names.flatMap((name) => {
      const callName = ctx.registry.resolve(name)?.descriptor.callName;
      const spec = tools.find((tool) => tool.name === callName);
      return spec ? [spec] : [];
    });
  const ranked = [...new Set([...specs(routed), ...tools.filter((tool) => !META.has(tool.name))])];
  return {
    meta: tools.filter((tool) => META.has(tool.name)),
    domain: requestedMeta ? [] : dedupe([...finishing, ...specs(loaded), ...ranked]),
    freshSelection:
      loaded.length > 0 &&
      !state.inputChanges.some((change) => !change.applied) &&
      latest?.kind === 'assistant' &&
      latest.toolCallIds.some((id) => state.toolCalls[id] === recent),
  };
}

/** One spec per tool name, the first kept: a finishing tool read from the registry and its loaded spec are one. */
function dedupe(tools: readonly ToolSpec[]): ToolSpec[] {
  const seen = new Set<string>();
  return tools.filter((tool) => !seen.has(tool.name) && seen.add(tool.name));
}
