// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A timeline's AI inventory with each asset's provenance looked up once through the library's port (the
 * signing stage and the export tool's disclosures read the same inventory). An asset whose provenance can't
 * be read counts as not generated: only a known generated asset is declared.
 */
import type { AssetId, AssetProvenance, AsyncResult, Timeline } from '@taalcut/core';
import { aiInventory, type AiInventory } from './ai-inventory';

/** Where each asset came from (the library's provenance). */
export type ProvenanceLookup = (assetId: AssetId) => AsyncResult<AssetProvenance['kind']>;

export async function inventoryOf(timeline: Timeline, lookup?: ProvenanceLookup): Promise<AiInventory> {
  const asked = new Set<AssetId>();
  aiInventory(timeline, (assetId) => {
    asked.add(assetId);
    return null;
  });
  const kinds = new Map<AssetId, AssetProvenance['kind']>();
  if (lookup)
    for (const assetId of asked) {
      const kind = await lookup(assetId);
      if (kind.ok) kinds.set(assetId, kind.value);
    }
  return aiInventory(timeline, (assetId) => kinds.get(assetId) ?? null);
}
