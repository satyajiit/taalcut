// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A pass's options with what it hands its caller counted (gray frames to `onFrame`, the RGB stream's batches to
 * `onFrames`): a pass that failed after handing some out must not run again, or the caller would see those frames
 * twice (IX2-F6, `retryStreaming`).
 */
import type { HandOutCounter } from '../decode-routes/software-retry';
import type { AnalysisPassOptions } from './pass-types';
import type { RgbBatch } from './rgb-stream';

export function countHanded(options: AnalysisPassOptions, counted: HandOutCounter): AnalysisPassOptions {
  const { onFrame, rgbStream } = options;
  return {
    ...options,
    ...(onFrame ? { onFrame: counted(onFrame) } : {}),
    ...(rgbStream
      ? {
          rgbStream: {
            ...rgbStream,
            onFrames: counted(rgbStream.onFrames, (batch: RgbBatch) => batch.count),
          },
        }
      : {}),
  };
}
