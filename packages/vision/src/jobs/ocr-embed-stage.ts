// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `vision.embedOcr` (IX-O5, OCR stage design section 5): the on-screen text vectors, once `vision.ocr` has stored the
 * text. Text only, no decode, on the text embedder like `vision.embedText` (`vision.embedTexts`). It replaces only the
 * `ocr` items, so it and `vision.embed` (frames) run in either order and neither waits for the other. It counts toward
 * the searchable milestone, so it runs at normal priority (design C).
 *
 * It reads `vision.ocr` (round IX3): when a re-read stores other words, it runs again and replaces the asset's text
 * vectors. With no text on screen it skips (nothing to embed, and no job waits in the embedder's lane), and the skip
 * clears the asset's text vectors, so a re-read that finds no text where an earlier one found some leaves none.
 */
import {
  defineIndexStage,
  ok,
  stageJob,
  type AssetIndexView,
  type IndexStageDefinition,
} from '@taalcut/core';
import { visionEmbedTextsJob } from './index-kinds';
import { OCR_STAGE } from './ocr-stages';
import { EMBED_OCR_VERSION } from './stage-frames';

export const EMBED_OCR_STAGE = 'vision.embedOcr';
/** No shot shows text on screen. */
export const SKIP_NO_TEXT = 'indexing.skip.noText';

/** Each analysed shot's on-screen text tracks, as `ocr:<shotId>:<n>` items. */
export function onScreenTexts(view: AssetIndexView) {
  return view.shots.flatMap((shot) =>
    (shot.analysis?.onScreenText ?? [])
      .map((text, n) => ({ itemId: `ocr:${shot.shotId}:${n}`, kind: 'ocr' as const, text: text.text }))
      .filter((item) => item.text.trim() !== ''),
  );
}

export function createEmbedOcrStage(): IndexStageDefinition {
  return defineIndexStage({
    stage: EMBED_OCR_STAGE,
    version: EMBED_OCR_VERSION,
    reads: [OCR_STAGE],
    needs: [OCR_STAGE],
    appliesTo: ['video', 'image', 'live_photo'],
    milestone: 'searchable',
    priority: 'normal',
    job: (view) => {
      const texts = onScreenTexts(view);
      if (texts.length === 0) return { skip: SKIP_NO_TEXT, clears: ['ocr'] };
      return stageJob(visionEmbedTextsJob, {
        assetId: view.assetId,
        sourceId: view.sourceId,
        path: view.path,
        contentHash: view.contentHash,
        texts,
        replaces: ['ocr'],
      });
    },
    result: () => ok({}),
  });
}
