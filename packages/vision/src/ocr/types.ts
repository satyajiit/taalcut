// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The OCR interface (P2-L6 client). OS-specific engines sit behind it: Apple
 * Vision through the mac helper, PP-OCRv5 Devanagari on ONNX Runtime WebGPU;
 * a Windows port adds implementations, not callers.
 */
import { createToken, type AsyncResult, type NormalisedBox, type TextScript } from '@taalcut/core';
import type { OcrMeter } from './meter';

/** One frame to read. Pixels are always there (PP-OCR needs them); `path` saves the helper a PNG write. */
export interface OcrFrame {
  /** Grid frame of the source, or 0 for a still. */
  readonly index: number;
  readonly width: number;
  readonly height: number;
  /** rgb24, row-major. */
  readonly rgb: Uint8Array;
  /** A JPEG or PNG of exactly these pixels, inside a folder the helper may read. */
  readonly path?: string;
}

export interface OcrObservation {
  /** NFC, trimmed. */
  readonly text: string;
  /** Normalised to the upright frame, origin top left. */
  readonly box: NormalisedBox;
  readonly confidence: number;
  readonly script: TextScript;
  /** BCP 47, when the engine says. */
  readonly language?: string;
  /** Which engine read it: 'apple-vision', 'ppocr-v5'. */
  readonly engine: string;
  /**
   * FIX-SIGN: the text's corners (top left, top right, bottom right, bottom left of the words as they read),
   * normalised, origin top left, when the engine gives them (Apple Vision does; PP-OCR's boxes are level).
   */
  readonly quad?: OcrQuad;
}

/** Four corners, normalised, origin top left. */
export type OcrQuad = readonly [
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
];

export interface OcrPage {
  /** The frame's grid index. */
  readonly frame: number;
  readonly observations: readonly OcrObservation[];
}

export interface OcrCapabilities {
  /** Scripts the engine reads. */
  readonly scripts: readonly TextScript[];
  /** BCP 47 tags it accepts ('en', 'es', 'pt-BR', 'hi', ...). */
  readonly languages: readonly string[];
}

export interface OcrRecognizeOptions {
  /** Languages the caller expects, in priority order. */
  readonly languages: readonly string[];
  readonly signal?: AbortSignal;
  /** The job's OCR counters (IX-O1); engines add their requests to it. */
  readonly meter?: OcrMeter;
}

/** An engine's warm-up (Apple Vision's, FIX-OCRCOLD): each step's script and time, in order. */
export interface OcrWarmReport {
  readonly steps: readonly { readonly script: string; readonly ms: number; readonly error?: string }[];
  readonly ms: number;
  /** Time the warm-up stood aside for real reads. */
  readonly yieldedMs: number;
  /**
   * The helper build's own compile cache folder under `~/Library/Caches` (a development build's, mac-helper SPEC
   * "OCR v2"); absent for a Developer ID build, which keeps the shared one.
   */
  readonly cache?: string;
}

export interface OcrEngine {
  /** What this engine reads on this Mac now (asks the helper the first time). */
  capabilities(): AsyncResult<OcrCapabilities>;
  /** One page per frame, in order. */
  recognize(frames: readonly OcrFrame[], options: OcrRecognizeOptions): AsyncResult<OcrPage[]>;
  /**
   * Starts the engine and waits until it has compiled what it reads with (Apple Vision: the helper's warm-up,
   * which compiles Vision's models for this Mac's Neural Engine once per helper build). Null: nothing to warm.
   */
  warm?(): AsyncResult<OcrWarmReport | null>;
  close?(): Promise<void>;
}

/** The engine the desktop wires (the routed one). Vision's own token: only vision uses it. */
export const OcrEngineToken = createToken<OcrEngine>('vision.ocrEngine');
