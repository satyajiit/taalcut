// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL, gates and evals only: in a test or development build with TAALCUT_RENDER_BOXES_DIR set, each export's
 * graphicCoversFace input (every graphic's and text item's probed box, and render's heads) is written there as
 * `<renderId>-r<round>.json`, so a face detector run on the exported file can be checked against what render drew.
 * A packaged app never writes it.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RenderEngineDeps } from '@taalcut/render';
import type { UtilityConfig } from '../../shared/rpc-ipc';

export function faceBoxesWriter(config: UtilityConfig): Pick<RenderEngineDeps, 'onFaceBoxes'> {
  const dir = !config.packaged ? process.env.TAALCUT_RENDER_BOXES_DIR : undefined;
  if (!dir) return {};
  return {
    onFaceBoxes: async ({ renderId, round }, dump) => {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${renderId}-r${round}.json`), JSON.stringify(dump));
    },
  };
}
