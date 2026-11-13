// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Fake OCR engines, frames and ONNX sessions for router, reuse, tracker and PP-OCR tests. */
import {
  err,
  ok,
  type AsyncResult,
  type ComputeBackend,
  type NormalisedBox,
  type TaalcutError,
} from '@taalcut/core';
import type { OnnxSession, OnnxTensor } from '../../../src/onnx/ort';
import { scriptOf } from '../../../src/ocr/text';
import type {
  OcrCapabilities,
  OcrEngine,
  OcrFrame,
  OcrObservation,
  OcrPage,
  OcrRecognizeOptions,
} from '../../../src/ocr/types';

export function frame(index: number, width = 8, height = 8, value = 0): OcrFrame {
  return { index, width, height, rgb: new Uint8Array(width * height * 3).fill(value) };
}

export function observation(
  text: string,
  box: NormalisedBox,
  confidence = 0.9,
  engine = 'fake',
  language?: string,
): OcrObservation {
  return { text, box, confidence, script: scriptOf(text), engine, ...(language ? { language } : {}) };
}

export interface FakeEngine extends OcrEngine {
  readonly calls: { frames: number[]; languages: readonly string[] }[];
}

export function fakeEngine(
  capabilities: OcrCapabilities | TaalcutError,
  read: (frame: OcrFrame, options: OcrRecognizeOptions) => readonly OcrObservation[] | TaalcutError,
): FakeEngine {
  const calls: { frames: number[]; languages: readonly string[] }[] = [];
  return {
    calls,
    async capabilities(): AsyncResult<OcrCapabilities> {
      return 'code' in capabilities ? err(capabilities) : ok(capabilities);
    },
    async recognize(frames, options): AsyncResult<OcrPage[]> {
      calls.push({ frames: frames.map((f) => f.index), languages: options.languages });
      const pages: OcrPage[] = [];
      for (const f of frames) {
        const result = read(f, options);
        if ('code' in result) return err(result);
        pages.push({ frame: f.index, observations: result });
      }
      return ok(pages);
    },
  };
}

export const LATIN_CAPS: OcrCapabilities = { scripts: ['latin'], languages: ['en', 'es', 'pt-BR', 'fr'] };
export const DEVA_CAPS: OcrCapabilities = { scripts: ['devanagari'], languages: ['hi'] };

/** A one-output ONNX session answering every run with `output(feeds)`. */
export function fakeSession(
  name: string,
  output: (feeds: Readonly<Record<string, OnnxTensor>>) => OnnxTensor,
  backend: ComputeBackend = 'webgpu',
): OnnxSession {
  return {
    backend,
    inputNames: ['x'],
    outputNames: [name],
    async run(feeds) {
      return ok({ [name]: output(feeds) });
    },
    async release() {},
  };
}
