// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stand-ins for the breakdown's model-backed steps in desktop tests: an
 * embedding model that turns a frame into a colour-grid vector (NOT
 * EmbeddingGemma; the same encoding as templates' FFmpeg stand-in, so the
 * breakdown's thresholds read it the same way), an OCR engine that isn't
 * there, and a component manager with nothing installed.
 */
import { err, NotFoundError } from '@taalcut/core';
import { OcrUnavailable, type EmbeddingModelLoader, type OcrEngine } from '@taalcut/vision';

/** 16 × 8 cells × 3 channels × (cos, sin) = 768, the space's width. */
const GRID_W = 16;
const GRID_H = 8;

export const colourGridLoader: EmbeddingModelLoader = async (_dir, device) => ({
  device,
  embedTexts: async (texts) => texts.map(() => new Float32Array(768).fill(1 / Math.sqrt(768))),
  embedImages: async (images) =>
    images.map((image) => {
      const vector = new Float32Array(GRID_W * GRID_H * 3 * 2);
      for (let gy = 0; gy < GRID_H; gy++)
        for (let gx = 0; gx < GRID_W; gx++) {
          const sums = [0, 0, 0];
          let count = 0;
          const x0 = Math.floor((gx * image.width) / GRID_W);
          const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * image.width) / GRID_W));
          const y0 = Math.floor((gy * image.height) / GRID_H);
          const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * image.height) / GRID_H));
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
              const at = (y * image.width + x) * 3;
              for (let c = 0; c < 3; c++) sums[c]! += image.rgb[at + c] ?? 0;
              count += 1;
            }
          for (let c = 0; c < 3; c++) {
            const angle = (sums[c]! / Math.max(1, count) / 255) * Math.PI;
            const i = ((gy * GRID_W + gx) * 3 + c) * 2;
            vector[i] = Math.cos(angle);
            vector[i + 1] = Math.sin(angle);
          }
        }
      return vector;
    }),
  dispose: async () => undefined,
});

export const noOcr: OcrEngine = {
  capabilities: async () => err(OcrUnavailable({ language: 'en' })),
  recognize: async () => err(OcrUnavailable({ language: 'en' })),
};

/** A component manager with nothing installed that refuses to download. */
export const noComponents = {
  get: async () => undefined,
  install: async (id: string) => err(NotFoundError({ entity: 'component', id })),
};
