// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The frame PP-OCRv5 Latin's output was recorded on (scripts/ppocr-record.ts): the three committed Latin lines. */
import type { OcrFrame } from '../../../src/ocr/types';
import { syntheticFrame } from './fixtures';

export const LATIN_SCENE = {
  width: 960,
  height: 540,
  lines: [
    { id: 'latin-en', left: 60, top: 60 },
    { id: 'latin-es', left: 60, top: 200 },
    { id: 'latin-pt', left: 60, top: 340 },
  ],
} as const;

export function latinScene(): OcrFrame {
  return syntheticFrame(0, LATIN_SCENE.width, LATIN_SCENE.height, LATIN_SCENE.lines);
}
