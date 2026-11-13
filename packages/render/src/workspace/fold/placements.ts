// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The timeline's planned compositions made ready to fold (HFW1 "hf: compile"): each one's entry read from the
 * project's workspace by its sha256, prepared again (the gate passed it; prepare is pure and gives the same result),
 * and every asset it loads found in the workspace with the type its bytes are, linked into the bundle under its
 * sha256 (`ws/<sha256>.<ext>`, so `compositionHash` and the bundle's key both follow the content). One that can't
 * be read or prepared is left out with a warning.
 */
import type { CompositionPlacement, WorkspaceAsset, WorkspaceReader } from './types';
import { prepareComposition } from '../gate/prepare';
import { assetReferences } from '../gate/assets';
import type { PlannedComposition } from '../../plan/types';

export type { WorkspaceAsset, WorkspaceReader };

export const ASSET_BUNDLE_DIR = 'ws';

/** A composition to fold: a planned graphic's, or the stills' (frames.ts). */
export type FoldSource = Omit<PlannedComposition, 'composition'> & {
  readonly composition: Pick<PlannedComposition['composition'], 'entry' | 'files'>;
};

export function placementsOf(
  planned: readonly FoldSource[],
  reader: WorkspaceReader | undefined,
  warn: (note: string) => void,
): CompositionPlacement[] {
  if (planned.length > 0 && !reader) {
    warn('the workspace is not readable here, so its compositions are left out');
    return [];
  }
  const placements: CompositionPlacement[] = [];
  for (const plan of planned) {
    const { composition } = plan;
    const entry = composition.files.find((file) => file.path === composition.entry);
    const text = entry ? reader?.text(entry.sha256) : undefined;
    if (text === undefined) {
      warn(`graphic ${plan.itemId}: its composition's ${composition.entry} is not in the workspace`);
      continue;
    }
    const prepared = prepareComposition(text);
    if (!prepared.ok) {
      warn(
        `graphic ${plan.itemId}: its composition no longer prepares (${prepared.findings[0]?.code ?? '?'})`,
      );
      continue;
    }
    const assets: Record<string, { bundlePath: string; source: string; key: string }> = {};
    let missing = false;
    for (const path of assetReferences(prepared.value)) {
      const file = composition.files.find((candidate) => candidate.path === path);
      const found = file ? reader?.asset(file.sha256) : undefined;
      if (!file || !found) {
        missing = true;
        continue;
      }
      assets[path] = {
        bundlePath: `${ASSET_BUNDLE_DIR}/${file.sha256}.${found.ext}`,
        source: found.file,
        key: file.sha256,
      };
    }
    if (missing) {
      warn(`graphic ${plan.itemId}: an asset its composition loads is not in the workspace`);
      continue;
    }
    placements.push({
      itemId: plan.itemId,
      span: plan.span,
      composition: prepared.value,
      values: plan.values,
      assets,
    });
  }
  return placements;
}
