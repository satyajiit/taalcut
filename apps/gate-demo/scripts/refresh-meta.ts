// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { OFFER_META_TOOLS } from '../src';
import { same, type Tape, type WireTool } from './refresh-offers';

const isMeta = (tool: WireTool) =>
  OFFER_META_TOOLS.has(tool.name) && tool.name !== '__pi_deferred_placeholder__';

/** Actual public-agent requests, serialized by the SDK, cover schemas absent from the registry catalogue. */
export function refreshMeta(tape: Tape, offers: Readonly<Record<string, readonly WireTool[]>>): number[] {
  const expected = tape.interactions.flatMap((row, index) =>
    row.request.body?.tools?.some(isMeta) ? [String(index)] : [],
  );
  if (!same(Object.keys(offers).sort(), expected.sort()))
    throw new Error('meta offers do not cover the tape');
  const updates: { index: number; tools: WireTool[] }[] = [];
  for (const key of expected) {
    const index = Number(key);
    const tools = tape.interactions[index]!.request.body!.tools!;
    const current = offers[key]!;
    if (
      !same(
        tools.filter(isMeta).map((tool) => tool.name),
        current.map((tool) => tool.name),
      )
    )
      throw new Error(`meta offer names or order changed at #${index}`);
    const byName = new Map(current.map((tool) => [tool.name, tool]));
    const next = tools.map((tool) => {
      if (!isMeta(tool)) return tool;
      const spec = byName.get(tool.name)!;
      return { ...spec, ...('cache_control' in tool ? { cache_control: tool.cache_control } : {}) };
    });
    if (!same(tools, next)) updates.push({ index, tools: next });
  }
  // Validate complete coverage before changing anything, so a refusal cannot leave a partial refresh.
  for (const update of updates) tape.interactions[update.index]!.request.body!.tools = update.tools;
  return updates.map(({ index }) => index);
}
