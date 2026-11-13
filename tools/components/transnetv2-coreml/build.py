# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# The `transnetv2-coreml` model (IX2-S8), from pack-transnetv2-coreml.sh:
#
#   build.py <upstreamDir> <outDir>
#
# 1. Upstream's TF SavedModel weights into upstream's PyTorch port, by upstream's own convert_weights.py; the port
#    must match TF on random windows (np.isclose on every output, as upstream's --test).
# 2. The Core ML rewrite (coreml_model.py) around the port; it must match the port to 1e-5 on random windows.
# 3. Traced and converted with coremltools to an fp32 ML Program for macOS 14 (input `frames` float32
#    [1, 100, 27, 48, 3], 0..255; outputs `single` and `many_hot`, [1, 100, 1]), saved as
#    <outDir>/TransNetV2.mlpackage. Converted without loading it (no GPU or Neural Engine needed here).
# Writes <outDir>/build-report.json.
import json, os, sys
import numpy as np
import torch

upstream_dir, out_dir = sys.argv[1:3]
sys.path.insert(0, os.path.join(upstream_dir, 'inference-pytorch'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

import tensorflow as tf  # noqa: E402
import coremltools as ct  # noqa: E402
import convert_weights  # noqa: E402  (upstream)
from coreml_model import TransNetV2CoreML  # noqa: E402

torch.manual_seed(0)
rng = np.random.default_rng(0)
report = {}

# 1. Upstream's weights in upstream's port.
port, saved = convert_weights.convert_weights(os.path.join(upstream_dir, 'inference', 'transnetv2-weights'))
port.eval()
windows = [rng.integers(0, 256, size=(1, 100, 27, 48, 3), dtype=np.uint8) for _ in range(4)]
with torch.no_grad():
    ported = [port(torch.from_numpy(w)) for w in windows]
from_tf = [saved(tf.cast(w, tf.float32)) for w in windows]
# Both give logits: the single-frame head, and {'many_hot': ...}.
matching = [
    min(float(np.isclose(p[0].numpy(), t[0].numpy()).mean()),
        float(np.isclose(p[1]['many_hot'].numpy(), t[1]['many_hot'].numpy()).mean()))
    for p, t in zip(ported, from_tf)
]
report['portMatchesTf'] = matching
if min(matching) < 1.0:
    raise SystemExit(f'error: the PyTorch port does not match TF ({matching})')

# 2. The rewrite against the port (the port returns logits; the rewrite, like the ONNX, probabilities).
model = TransNetV2CoreML(port).eval()
worst = 0.0
with torch.no_grad():
    for w, (single, many) in zip(windows, ported):
        s, m = model(torch.from_numpy(w).float())
        worst = max(worst, float((s - torch.sigmoid(single)).abs().max()),
                    float((m - torch.sigmoid(many['many_hot'])).abs().max()))
report['rewriteMaxAbsDiff'] = worst
if worst > 1e-5:
    raise SystemExit(f'error: the Core ML rewrite differs from the port by {worst}')

# 3. Converted.
example = torch.from_numpy(windows[0]).float()
with torch.no_grad():
    traced = torch.jit.trace(model, example)
mlmodel = ct.convert(
    traced,
    inputs=[ct.TensorType(name='frames', shape=(1, 100, 27, 48, 3))],
    outputs=[ct.TensorType(name='single'), ct.TensorType(name='many_hot')],
    convert_to='mlprogram',
    compute_precision=ct.precision.FLOAT32,
    minimum_deployment_target=ct.target.macOS14,
    compute_units=ct.ComputeUnit.CPU_ONLY,
    skip_model_load=True,
)
mlmodel.short_description = 'TransNetV2 shot transition detection (Core ML rewrite, fp32)'
mlmodel.author = 'Tomáš Souček and Jakub Lokoč (TransNetV2); Core ML conversion by Taalcut'
mlmodel.license = 'MIT (code and weights, Copyright (c) 2020 Tomáš Souček)'
# coremltools adds its own keys to this map, whose order the compiled model then varies from run to run: one key
# instead, so a second pack gives the same bytes (the versions are in build-report.json).
metadata = mlmodel.user_defined_metadata
for key in list(metadata.keys()):
    del metadata[key]
metadata['taalcut.build'] = f'pack-transnetv2-coreml.sh: coremltools {ct.__version__}, torch {torch.__version__}'
os.makedirs(out_dir, exist_ok=True)
mlmodel.save(os.path.join(out_dir, 'TransNetV2.mlpackage'))
report['versions'] = {'torch': torch.__version__, 'coremltools': ct.__version__, 'tensorflow': tf.__version__,
                      'numpy': np.__version__}
with open(os.path.join(out_dir, 'build-report.json'), 'w') as f:
    json.dump(report, f, indent=1)
print(json.dumps(report), flush=True)
