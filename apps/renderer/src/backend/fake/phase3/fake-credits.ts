// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- credit lines are the licence's words, kept as written */

/**
 * P3-V18 for the export dialog's Credits section: the credits a video's stock and bundled sounds ask for
 * (library.credits), as the library works them out (library's stock/attribution.ts): a stock item's attribution
 * line is required (CC BY), a Pexels clip gets the courtesy line "Video by <author> on Pexels", CC0 (stock or
 * Taalcut's bundled packs) asks for nothing. Each asset's provenance is the library's: the fake library's clips
 * are captured; stock, generated and bundled ones are what the export area's state recorded for them.
 * fake-phase3.ts spreads `router` into `library`.
 */
import {
  appContract,
  creditsSchema,
  implementContract,
  toRpcError,
  ValidationError,
  type AssetId,
  type AssetProvenance,
  type Credits,
} from '@taalcut/core';
import { exportState } from '../make/p3/interchange/export-state';
import type { FakeLibrary } from '../library/fake-library';

const PROCEDURES = { credits: appContract.library.credits };

/** The credit lines for these assets' provenance, deduplicated, in the order the assets came. */
export function creditsFor(provenances: readonly (AssetProvenance | null)[]): Credits {
  const required = new Set<string>();
  const courtesy = new Set<string>();
  for (const provenance of provenances) {
    if (provenance?.kind !== 'stock') continue;
    if (provenance.attribution.length > 0) required.add(provenance.attribution);
    if (provenance.licence === 'Pexels-Licence' && provenance.author)
      courtesy.add(`Video by ${provenance.author} on Pexels`.slice(0, 500));
  }
  return { required: [...required], courtesy: [...courtesy] };
}

export function createFakeCredits(library: FakeLibrary) {
  const os = implementContract(PROCEDURES);
  const provenanceOf = async (assetId: AssetId): Promise<AssetProvenance | null> =>
    exportState().provenance.get(assetId) ?? (await library.library.asset(assetId))?.asset.provenance ?? null;
  return {
    router: {
      credits: os.credits.handler(async ({ input }) => {
        const credits = creditsFor(await Promise.all(input.assetIds.map(provenanceOf)));
        const parsed = creditsSchema.safeParse(credits);
        if (!parsed.success) throw toRpcError(ValidationError({ field: 'credits' }));
        return parsed.data;
      }),
    },
  };
}
