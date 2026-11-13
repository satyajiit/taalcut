// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The PP-OCRv5 mobile recognisers the PP-OCR engine can run. Both share the
 * detector (PaddlePaddle/PP-OCRv5_mobile_det_onnx) and the recogniser input
 * (48 × 320 BGR, inference.yml `RecResizeImg`); they differ in charset and
 * languages. Each is one component folder: det/inference.onnx,
 * rec/inference.onnx, charset.json (rec/inference.yml's `character_dict` as a
 * JSON array) and the two inference.yml.
 */
import type { TextScript } from '@taalcut/core';

export interface PaddleModel {
  /** Component id in the manifest. */
  readonly component: string;
  /** What the meter calls its requests. */
  readonly meterEngine: 'ppocr-v5' | 'ppocr-v5-latin';
  readonly scripts: readonly TextScript[];
  /** Base languages it reads. */
  readonly languages: readonly string[];
  /** Entries in charset.json; the CTC head is this plus the blank and the space. */
  readonly charsetSize: number;
  /** The language its own script's readings carry. */
  readonly scriptLanguage?: { readonly script: TextScript; readonly language: string };
}

/** Spike 05's Hindi path: PaddlePaddle/devanagari_PP-OCRv5_mobile_rec_onnx @251aec19. */
export const PADDLE_DEVANAGARI: PaddleModel = {
  component: 'ppocr-v5-devanagari',
  meterEngine: 'ppocr-v5',
  scripts: ['devanagari'],
  languages: ['hi'],
  charsetSize: 568,
  scriptLanguage: { script: 'devanagari', language: 'hi' },
};

/**
 * Latin text off Apple Silicon (IX-O7): PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx @89d3a50e (Apache-2.0,
 * inference.onnx 8042023 bytes, sha256 78881130…1498). Its 836-entry charset holds every letter of the languages
 * below (checked against the charset: es lacks only '¡'); Vietnamese's stacked diacritics are not in it.
 * Not yet a manifest component, and not run on Windows hardware.
 */
export const PADDLE_LATIN: PaddleModel = {
  component: 'ppocr-v5-latin',
  meterEngine: 'ppocr-v5-latin',
  scripts: ['latin'],
  languages: 'en es pt fr de it nl pl cs ro tr sv da no nb fi hu ca hr is id ms'.split(' '),
  charsetSize: 836,
};
