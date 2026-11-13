# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""Rewrites every grouped Conv (group > 1) of an ONNX graph as the same dense Conv (group = 1): the weight of
group g sits in input channels [g * cin_g, (g + 1) * cin_g) of its output channels and every other weight is zero,
so the output is the same. onnxruntime's WebGPU execution provider computes a grouped Conv wrongly when its channels
per group aren't a multiple of 4 (RTMO-s: six 3 × 3 convs, group 8, 18 channels per group); the dense form runs
right there and on the CPU (packages/vision SPEC, "Subjects without the helper").

    python densify.py IN.onnx OUT.onnx
"""
import sys

import numpy as np
import onnx
from onnx import helper, numpy_helper

source, target = sys.argv[1:3]
model = onnx.load(source)
weights = {init.name: init for init in model.graph.initializer}
changed = 0
for node in model.graph.node:
    if node.op_type != 'Conv':
        continue
    attrs = {attr.name: attr for attr in node.attribute}
    groups = helper.get_attribute_value(attrs['group']) if 'group' in attrs else 1
    if groups == 1:
        continue
    weight = numpy_helper.to_array(weights[node.input[1]])
    cout, cin_g = weight.shape[:2]
    cout_g = cout // groups
    dense = np.zeros((cout, cin_g * groups) + weight.shape[2:], dtype=weight.dtype)
    for g in range(groups):
        dense[g * cout_g:(g + 1) * cout_g, g * cin_g:(g + 1) * cin_g] = weight[g * cout_g:(g + 1) * cout_g]
    name = node.input[1] + '_dense'
    model.graph.initializer.append(numpy_helper.from_array(dense, name))
    node.input[1] = name
    attrs['group'].i = 1
    changed += 1
# The grouped weights no node reads any more.
used = {name for node in model.graph.node for name in node.input}
kept = [init for init in model.graph.initializer if init.name in used]
del model.graph.initializer[:]
model.graph.initializer.extend(kept)
onnx.checker.check_model(model)
onnx.save(model, target)
print(f'{changed} grouped convs made dense', file=sys.stderr)
