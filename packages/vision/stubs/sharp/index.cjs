// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * transformers.js imports sharp when it loads, and only calls it to decode
 * or resize an image. @taalcut/vision decodes and scales frames with FFmpeg
 * (VideoToolbox) to exactly the size the image processor wants, so a call
 * here is a bug: it throws instead of decoding on the CPU.
 */
'use strict';

function sharp() {
  throw new Error(
    'sharp is not bundled with Taalcut: pass RawImage frames already at the image processor size.',
  );
}

module.exports = sharp;
module.exports.default = sharp;
