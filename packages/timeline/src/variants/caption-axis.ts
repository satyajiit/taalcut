// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The caption axis (P3-V3): variant k wears the first caption preset whose look the base and no earlier variant
 * wears. Only the look changes; the words and their timing stay. A base without captions can't vary on it
 * (`timeline.no_captions`).
 */
import { isDeepStrictEqual } from 'node:util';
import {
  CAPTION_PRESET_IDS,
  CAPTION_PRESETS,
  err,
  ok,
  type AsyncResult,
  type CaptionPresetId,
  type Timeline,
} from '@taalcut/core';
import { NoCaptions } from '../errors';
import { captionPresetOf, withCaptionStyle } from '../styles/caption-look';
import type { AxisInput, VariantAxis } from './axis';

async function vary({ base, drafts, request }: AxisInput): AsyncResult<Timeline[]> {
  const captions = base.captions;
  if (!captions) return err(NoCaptions());
  const order = request.captionPresets ?? CAPTION_PRESET_IDS;
  const worn = captionPresetOf(captions);
  const used = new Set<CaptionPresetId>(worn ? [worn] : []);
  const out: Timeline[] = [];
  for (const draft of drafts) {
    const preset = order.find(
      (id) => !used.has(id) && !isDeepStrictEqual(CAPTION_PRESETS[id], captions.style),
    );
    if (!preset) break;
    used.add(preset);
    out.push({ ...draft, captions: withCaptionStyle(draft.captions ?? captions, CAPTION_PRESETS[preset]) });
  }
  return ok(out);
}

export const captionAxis: VariantAxis = { id: 'captions', vary };
