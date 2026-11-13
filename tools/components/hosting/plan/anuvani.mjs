// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CIIL Anuvani-LID, the Indian-language identifier (LIB1-LANG; manifest.anuvani.provisional.json, pending until it is
 * hosted): its accelerator format, the front end and the encoder from the model's own mobile_inference/models at rev
 * 3b9caa41, repacked unchanged as one tar.zst. Apache-2.0, code and weights (the model card).
 */
import { TEXTS } from '../texts.mjs';
import { hf, REPACKED } from './common.mjs';

const REPO = 'CIIL/Anuvani-LID';
const REV = '3b9caa41c0a5ec5a09d38f3aecb2fa1dd6602531';

const pinned = (name, size, sha256) => ({
  path: name,
  pin: { url: hf(REPO, REV, `mobile_inference/models/${name}`), size, sha256 },
});

export const ANUVANI = {
  'anuvani-lid': {
    file: 'anuvani-lid-3b9caa41-npu-15s.tar.zst',
    signature: 'none',
    recipe: {
      kind: 'pack',
      layout: 'file',
      files: [
        pinned(
          'anuvani_lid.npu-15s.encoder.onnx',
          471230968,
          '630356c48239d9b18e6dfad652bc1d1730077138c44a2b50c0bda662336864ec',
        ),
        pinned(
          'anuvani_lid.npu-15s.frontend.onnx',
          102134,
          '63365e0fb4e2e93ba82630b66829cf255c0b4f910259aba3f556e661d119d5a6',
        ),
      ],
    },
    notice: { changes: REPACKED, texts: [TEXTS.apache2] },
  },
};
