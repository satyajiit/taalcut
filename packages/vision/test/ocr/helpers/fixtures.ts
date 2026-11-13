// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The committed text-line PNGs, painted onto synthetic frames. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OcrFrame } from '../../../src/ocr/types';
import { composite, readPng, type DecodedPng } from './png-decode';

export const FIXTURE_DIR = fileURLToPath(new URL('../../fixtures/text/', import.meta.url));
/** The PP-OCRv5 component, fetched once into the gitignored cache (see SPEC, Components). */
export const PADDLE_DIR = fileURLToPath(new URL('../../../.cache/ppocr-v5-devanagari/', import.meta.url));
export const HAS_PADDLE =
  existsSync(`${PADDLE_DIR}det/inference.onnx`) &&
  existsSync(`${PADDLE_DIR}rec/inference.onnx`) &&
  existsSync(`${PADDLE_DIR}charset.json`);

export interface FixtureLine {
  readonly file: string;
  readonly text: string;
  readonly language: string;
  readonly width: number;
  readonly height: number;
}

export const LINES: readonly FixtureLine[] = JSON.parse(
  readFileSync(`${FIXTURE_DIR}lines.json`, 'utf8'),
) as FixtureLine[];

export function line(id: string): { meta: FixtureLine; png: DecodedPng } {
  const meta = LINES.find((l) => l.file === `${id}.png`);
  if (!meta) throw new Error(`no fixture line ${id}`);
  return { meta, png: readPng(`${FIXTURE_DIR}${meta.file}`) };
}

/** A frame with a soft diagonal gradient (like footage, not a flat card) and lines painted at given points. */
export function syntheticFrame(
  index: number,
  width: number,
  height: number,
  placed: readonly { id: string; left: number; top: number }[],
): OcrFrame {
  const canvas = { width, height, data: new Uint8Array(width * height * 3) };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      canvas.data[i] = 60 + Math.round((80 * x) / width);
      canvas.data[i + 1] = 90 + Math.round((60 * y) / height);
      canvas.data[i + 2] = 120;
    }
  }
  for (const item of placed) composite(canvas, line(item.id).png, item.left, item.top);
  return { index, width, height, rgb: canvas.data };
}
