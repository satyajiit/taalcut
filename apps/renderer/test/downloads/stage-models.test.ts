// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX2-MODELS: which models a clip waits for, from its stage rows: a held stage's error names its component; the
// embedding stages, held back before they run, wait for EmbeddingGemma 2; stages waiting for anything else don't count.
import type { AssetDetail } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { MODEL_MISSING_REASON, modelsForStages } from '../../src/features/downloads/stage-models';

type Stage = AssetDetail['stages'][number];

const held = (stage: string, component: string): Stage => ({
  stage,
  state: 'waiting',
  reasonKey: MODEL_MISSING_REASON,
  error: {
    code: 'audio.model_missing',
    messageKey: 'errors.audio.model_missing',
    retryable: false,
    params: { component },
  },
});
const blocked = (stage: string): Stage => ({ stage, state: 'waiting', reasonKey: MODEL_MISSING_REASON });

describe('modelsForStages', () => {
  it('the PO’s clip: whisper-tiny for the language stage, EmbeddingGemma 2 once for the four embedding stages', () => {
    const stages: Stage[] = [
      { stage: 'media.normalise', state: 'done' },
      held('audio.language', 'whisper-tiny'),
      blocked('vision.describe'),
      blocked('vision.embed'),
      blocked('vision.embedOcr'),
      blocked('vision.embedText'),
      // Behind the language stage: waiting, but not for a model.
      { stage: 'audio.transcript', state: 'waiting' },
      { stage: 'vision.ocr', state: 'waiting' },
    ];
    expect(modelsForStages(stages)).toEqual(['whisper-tiny', 'embeddinggemma-2']);
  });

  it('UX3-IDX on Linux: PP-OCRv5 Latin for on-screen text, from a held job’s error or held back up front', () => {
    const vision = (component: string): Stage => ({
      ...held('vision.ocr', component),
      error: {
        code: 'vision.model_missing',
        messageKey: 'errors.vision.model_missing',
        retryable: false,
        params: { component },
      },
    });
    expect(modelsForStages([blocked('vision.ocr')])).toEqual(['ppocr-v5-latin']);
    expect(modelsForStages([vision('ppocr-v5-devanagari')])).toEqual(['ppocr-v5-devanagari']);
  });

  it('LIB1-FIX: a description waits for the model that describes once the search model is here', () => {
    const done = (stage: string): Stage => ({ stage, state: 'done' });
    // EmbeddingGemma is here (the embedding stages ran): the description waits for Qwen3.5 4B and its projector.
    expect(
      modelsForStages([done('vision.embed'), done('vision.embedOcr'), blocked('vision.describe')]),
    ).toEqual(['local-llm-qwen3-5-4b', 'local-llm-qwen3-5-4b-mmproj']);
    // While the embedding stages wait too, EmbeddingGemma is what is missing: on an 8 GB Mac, or with descriptions in
    // the cloud, it is the only model a description waits for, and Qwen isn't in that Mac's download.
    expect(modelsForStages([blocked('vision.embed'), blocked('vision.describe')])).toEqual([
      'embeddinggemma-2',
    ]);
    // Held by its own job while the runtime isn't ready: its error names the model.
    const runtime: Stage = {
      ...blocked('vision.describe'),
      error: {
        code: 'vision.model_missing',
        messageKey: 'errors.vision.model_missing',
        retryable: false,
        params: { component: 'local-llm-qwen3-5-4b' },
      },
    };
    expect(modelsForStages([done('vision.embed'), runtime])).toEqual(['local-llm-qwen3-5-4b']);
  });

  it('nothing when no stage waits for a model, or one waits for a model it can’t name', () => {
    expect(modelsForStages([{ stage: 'audio.language', state: 'done' }])).toEqual([]);
    expect(modelsForStages([blocked('vision.somethingNew')])).toEqual([]);
    expect(
      modelsForStages([
        { stage: 'vision.embed', state: 'waiting', reasonKey: 'library.stage.originalOffline' },
      ]),
    ).toEqual([]);
  });
});
