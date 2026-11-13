// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The export dialog's Content Credentials note (P3-V7, SPEC P3.3): the project's option, how many of the
 * timeline's originals already carry a manifest (with the option off they are not kept: the re-encode drops
 * them), and the platforms that ask for an AI disclosure when the inventory has generated parts.
 */
import type { AssetId, ExportCredentials, ProjectId, SettingsStore, Timeline } from '@taalcut/core';
import { disclosuresFor, hasC2paManifestBox, inventoryOf, type ProvenanceLookup } from '../credentials';
import type { AssetFiles } from '../ports';
import { readExportSettings } from '../settings';

export interface ExportCredentialsDeps {
  readonly assets: AssetFiles;
  readonly settings?: SettingsStore;
  readonly provenance?: ProvenanceLookup;
}

/** The distinct assets a timeline shows or plays. */
function assetIdsOf(timeline: Timeline): Set<AssetId> {
  const ids = new Set<AssetId>();
  for (const track of timeline.tracks)
    for (const item of track.items) if ('media' in item) ids.add(item.media.assetId);
  return ids;
}

/** How many originals carry their own C2PA manifest (an unreadable or offline one counts as none). */
async function signedOriginals(timeline: Timeline, assets: AssetFiles): Promise<number> {
  let count = 0;
  for (const assetId of assetIdsOf(timeline)) {
    const original = await assets.original(assetId);
    if (!original.ok || !original.value) continue;
    if (await hasC2paManifestBox(original.value.path).catch(() => false)) count++;
  }
  return count;
}

export async function exportCredentials(
  deps: ExportCredentialsDeps,
  projectId: ProjectId,
  timeline: Timeline,
): Promise<ExportCredentials> {
  const settings = await readExportSettings(deps.settings, projectId);
  const inventory = await inventoryOf(timeline, deps.provenance);
  return {
    add: settings.ok ? settings.value.contentCredentials.add : false,
    sourcesWithCredentials: await signedOriginals(timeline, deps.assets),
    disclosures: disclosuresFor(inventory),
  };
}
