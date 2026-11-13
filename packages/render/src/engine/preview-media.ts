// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { extractFrame } from '@taalcut/media';
import type { CompositionMediaEntry } from '../compile/composition';
import { MediaMissing } from '../errors';
import type { RenderPlan } from '../plan/types';
import type { RenderEngineDeps } from './deps';
import { playableFile } from './playable-file';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** Holds decode once from the original, using media's GPU-first frame path. Color and overlays stay editable. */
export async function previewMedia(
  deps: RenderEngineDeps,
  plan: RenderPlan,
  dir: string,
): AsyncResult<Map<string, CompositionMediaEntry>> {
  const entries = new Map<string, CompositionMediaEntry>();
  for (const visual of plan.visuals) {
    if (!visual.enabled) continue;
    const source = await playableFile(
      deps.assets,
      visual.assetId,
      visual.kind === 'video' && !visual.holdFrame,
    );
    const info = source ? await stat(source).catch(() => null) : null;
    if (!source || !info?.isFile()) return err(MediaMissing({ name: visual.id }));
    let file = source;
    let ext = extname(source).slice(1).toLowerCase() || (visual.kind === 'image' ? 'jpg' : 'mp4');
    let key = hash(`${source}\0${info.size}\0${Math.round(info.mtimeMs)}`);
    if (visual.holdFrame) {
      key = hash(`${key}:${JSON.stringify(visual.holdFrame)}`);
      file = join(dir, `hold-${key}.png`);
      ext = 'png';
      if (!(await stat(file).catch(() => null))) {
        const frame = visual.holdFrame;
        const at = { value: Math.max(0, frame.value * 4 - 1), rate: (frame.rate.num * 4) / frame.rate.den };
        const still = await extractFrame(source, at, deps.media, { format: 'png', maxDimension: 1920 });
        if (!still.ok) return still;
        await writeFile(file, still.value.data);
      }
    }
    entries.set(visual.id, { file, key, ext, mediaStart: visual.sourceIn, playbackRate: visual.meanSpeed });
  }
  return ok(entries);
}
