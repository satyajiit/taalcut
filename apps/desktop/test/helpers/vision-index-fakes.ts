// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stand-ins for the models behind vision's index stages, for desktop tests that run the real handlers on a
 * synthetic reel: an OCR engine that reads one word on every frame (or the frames before one) and a describer that answers every frame
 * the same. The embedder is breakdown-fakes' colour grid; the shot-boundary stand-in is vision's test support.
 */
import { ok, type BackgroundModels } from '@taalcut/core';
import type { OcrEngine } from '@taalcut/vision';

/** Reads `word` on every frame before frame `before` (all of them by default), nothing after. */
export const wordOcr = (word: string, before = Number.POSITIVE_INFINITY): OcrEngine => ({
  capabilities: async () => ok({ scripts: ['latin'], languages: ['en'] }),
  recognize: async (frames) =>
    ok(
      frames.map((frame) => ({
        frame: frame.index,
        observations:
          frame.index < before
            ? [
                {
                  text: word,
                  box: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
                  confidence: 0.95,
                  script: 'latin' as const,
                  engine: 'test',
                },
              ]
            : [],
      })),
    ),
});

export const sameDescription: BackgroundModels = {
  complete: async () =>
    ok({
      status: 'answered',
      text: '{"description":"A flat field of colour.","objects":["colour"]}',
      provider: 'test',
      model: 'test',
      local: true,
      costUsd: 0,
      uploadedTo: [],
    }),
};
