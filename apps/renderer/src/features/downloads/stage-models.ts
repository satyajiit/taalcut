// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AssetDetail } from '@taalcut/core';

/** library.stage.modelMissing: a stage that waits for an on-device model (packages/library model-missing.ts). */
export const MODEL_MISSING_REASON = 'library.stage.modelMissing';

/**
 * The stages the desktop holds back before they run while their model isn't installed (its index-stages.ts
 * `notReady`): they carry no error naming it. The embedding stages write EmbeddingGemma 2 vectors; on-screen text
 * reading waits for PP-OCRv5 Latin where there is no Apple Vision (UX3-IDX; a Mac never holds it).
 */
const EMBEDDING = 'embeddinggemma-2';
const BLOCKED_UP_FRONT: Readonly<Record<string, string>> = {
  'vision.embed': EMBEDDING,
  'vision.embedText': EMBEDDING,
  'vision.embedOcr': EMBEDDING,
  'vision.ocr': 'ppocr-v5-latin',
};

/**
 * The model that describes clips on Recommended and High Macs: its weights and projector (desktop index-stages.ts
 * `describerNeeds`). Its runtime, a small part whose build differs by computer, comes in the same download.
 */
const DESCRIBER = ['local-llm-qwen3-5-4b', 'local-llm-qwen3-5-4b-mmproj'];

type Stage = AssetDetail['stages'][number];

const heldForModel = (stage: Stage) => stage.state === 'waiting' && stage.reasonKey === MODEL_MISSING_REASON;

/**
 * What a held description waits for (LIB1-FIX). It stores its vectors with EmbeddingGemma, so while the embedding
 * stages wait, that is the model missing; on an 8 GB Mac, or with descriptions in the cloud, it is the only one.
 * Otherwise it waits for the model that describes.
 */
function describeWaitsFor(stages: readonly Stage[]): readonly string[] {
  const embedding = stages.some(
    (stage) => BLOCKED_UP_FRONT[stage.stage] === EMBEDDING && heldForModel(stage),
  );
  return embedding ? [EMBEDDING] : DESCRIBER;
}

/** The components a model-waiting stage needs: its error names one (a job found it missing), or its stage does. */
function componentsOf(stage: Stage, stages: readonly Stage[]): readonly string[] {
  const named = stage.error?.params?.['component'];
  if (typeof named === 'string' && named !== '') return [named];
  if (stage.stage === 'vision.describe') return describeWaitsFor(stages);
  const blocked = BLOCKED_UP_FRONT[stage.stage];
  return blocked ? [blocked] : [];
}

/** The component ids an asset's model-waiting stages need, once each, in stage order. */
export function modelsForStages(stages: AssetDetail['stages']): string[] {
  return [...new Set(stages.filter(heldForModel).flatMap((stage) => componentsOf(stage, stages)))];
}
