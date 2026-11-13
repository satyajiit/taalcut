// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Port of the mac helper's `text.render`. Production calls an implementation of
 * this interface; it does not shell out, and it does not draw with system fonts.
 * The test double lives in the test file, not here.
 */
import { type AsyncResult } from '@taalcut/core';

export interface TextRenderRequest {
  readonly string: string;
  readonly fontFile: string;
  /** 24–256. The whole string is rendered, never one glyph (conjuncts change the ink). */
  readonly pixelHeight: number;
  readonly polarity: 'darkOnLight' | 'lightOnDark';
}

export interface TextRenderResult {
  /** Row-major 8-bit gray, length width*height. */
  readonly gray: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly ascent: number;
  readonly descent: number;
  readonly xHeight: number;
  readonly inkBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface TextRenderer {
  render(request: TextRenderRequest, signal?: AbortSignal): AsyncResult<TextRenderResult>;
}
