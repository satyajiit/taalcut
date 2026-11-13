# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# The mac helper's `shots` test fixture (IX2-S9), from pack-transnetv2-coreml.sh:
#
#   fixture.py <transnetv2.onnx> <out.json>
#
# One synthetic window (a hard cut between frames 49 and 50, a little motion; the same formula as ShotsTests.swift,
# `syntheticWindow`) and what the shipped ONNX (onnxruntime, CPU) predicts for it, so the helper's model-present
# test compares its Core ML answer with the ONNX's without the footage.
import json, sys
import numpy as np
import onnxruntime as ort

onnx_path, out_path = sys.argv[1:3]
t, y, x, c = np.meshgrid(np.arange(100), np.arange(27), np.arange(48), np.arange(3), indexing='ij')
base = np.where(t < 50, 30, 170)
window = ((base + 5 * x + 3 * y + 60 * c + 2 * (t % 5)) % 256).astype(np.float32)
session = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
single, many = session.run(None, {session.get_inputs()[0].name: window[None]})
doc = {
    'formula': '(t < 50 ? 30 : 170) + 5x + 3y + 60c + 2(t mod 5), mod 256, for frame t, row y, column x, channel c',
    'single': [round(float(v), 7) for v in single[0, :, 0]],
    'manyHot': [round(float(v), 7) for v in many[0, :, 0]],
}
with open(out_path, 'w') as f:
    json.dump(doc, f, indent=1)
    f.write('\n')
print(f'fixture: single max {single.max():.4f} at frame {int(single[0, :, 0].argmax())}', flush=True)
