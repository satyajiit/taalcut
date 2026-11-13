# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# The IX3-N1 study of smaller Core ML weights for the `embeddinggemma-2-coreml` component: rewrites the fp16 weight
# matrices of one of q4_surgery.py's multifunction .mlpackage graphs as Core ML compressed weights
# (coremltools.optimize.coreml, https://apple.github.io/coremltools/docs-guides/source/opt-quantization-algos.html and
# opt-palettization-algos.html; macOS 15 ops). Not used by the pack: compressed weights ran at half the fp16 graphs'
# speed (vision SPEC, "Smaller Core ML download"), so the component ships a recipe that writes today's fp16 weights from
# the ONNX component instead (weight_recipe.py). Usage, from a study:
#
#   compress_weights.py <scheme> <onnxDir> <in.mlpackage> <out.mlpackage> <report.json>
#
# Schemes (only matrices fed to a `linear` op's weight; the others stay fp16):
# - int4: per-block linear 4-bit, `constexpr_blockwise_shift_scale` with uint4 codes and zero points and an
#   fp16 scale per block of 32 input channels, holding the ONNX component's own codes, zero points and scales. Every
#   matrix q4_surgery.py wrote is the dequantised copy of one of them, found here by its bytes, so the weights are
#   today's: the same codes, the scale rounded to fp16 (the text graph's are float32 in ONNX). A matrix that is not a
#   dequantised ONNX 4-bit matrix (the vision projection, fp16 in the ONNX component too) stays fp16.
# - int4-requant (study): coremltools' own per-block quantiser (`OpLinearQuantizerConfig`, mode "linear", uint4,
#   blocks of 32) over the same matrices. Its min/max grid misses the ONNX grid in blocks whose codes don't span 0-15.
# - pal6 (study): 6-bit palettisation (`OpPalettizerConfig`, k-means, one 64-entry table per matrix).
#
# coremltools' compression API refuses multifunction models (rdar://126084385), so the program is loaded with all its
# functions, rewritten function by function (the same matrix gives the same result in each), and saved as
# coremltools' save_multifunction does: equal constants shared across functions, one blob each. The report lists, per
# matrix, how far the dequantised weight is from the fp16 one it replaces.
import hashlib, json, os, sys
import numpy as np
import coremltools as ct
import onnx
from coremltools.converters.mil.converter import mil_convert
from coremltools.converters.mil.frontend.milproto.load import load as milproto_load
from coremltools.converters.mil.mil import Builder as mb, types
from coremltools.converters.mil.mil.passes.graph_pass import PassOption
from coremltools.converters.mil.mil.passes.helper import block_context_manager
from coremltools.converters.mil.mil.passes.pass_registry import PASS_REGISTRY
from coremltools.optimize.coreml import OpLinearQuantizerConfig, OpPalettizerConfig, OptimizationConfig

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # run with -I: onnx_q4.py sits beside this file
from onnx_q4 import dequantise, matmulnbits_codes

BLOCK = 32
SCHEMES = ('int4', 'int4-requant', 'pal6')
scheme, onnx_dir, pkg_in, pkg_out, report_path = sys.argv[1:6]
if scheme not in SCHEMES:
    raise SystemExit(f'scheme {scheme}: one of {", ".join(SCHEMES)}')


def onnx_four_bit():
    """Every MatMulNBits matrix of the two ONNX graphs, split as q4_surgery.py splits fused ones, by the bytes of its
    fp16 dequantised copy: (codes [N, K], zero points [N, K/32], scales [N, K/32]) for y = x @ w.T."""
    out = {}
    for graph in ('model_q4.onnx', 'vision_encoder_q4f16.onnx'):
        model = onnx.load(os.path.join(onnx_dir, 'onnx', graph), load_external_data=True)
        inits = {i.name: i for i in model.graph.initializer}
        for node in model.graph.node:
            if node.op_type != 'MatMulNBits':
                continue
            codes, zeros, scales, block = matmulnbits_codes(inits, node)
            assert block == BLOCK and codes.shape[1] % BLOCK == 0, (node.name, block, codes.shape)
            n = codes.shape[0]
            weight = dequantise(codes, zeros, scales, block).astype(np.float16)
            # Fused projections: q4_surgery.py writes each part into its own Core ML matrix; any row split is tried.
            cuts = [(0, n)]
            if 'qkv_proj' in node.name:
                q = n - 1024
                cuts = [(0, q), (q, q + 512), (q + 512, n)]
            elif n == 4096 and 'gate_up' in node.name:
                cuts = [(0, 2048), (2048, 4096)]
            for a, b in cuts:
                out[hashlib.sha256(weight[a:b].tobytes()).hexdigest()] = (codes[a:b], zeros[a:b], scales[a:b])
    return out


def linear_weights(function):
    """The fp16 matrices fed to a `linear` op's weight: const op by name."""
    out = {}
    for op in function.operations:
        if op.op_type != 'const':
            continue
        val = op.outputs[0].val
        if not isinstance(val, np.ndarray) or val.ndim != 2 or val.dtype != np.float16 or val.shape[1] % BLOCK:
            continue
        children = op.outputs[0].child_ops
        if children and all(c.op_type == 'linear' and c.inputs.get('weight') is op.outputs[0] for c in children):
            out[op.name] = op
    return out


spec = ct.utils.load_spec(pkg_in)
prog = milproto_load(spec, spec.specificationVersion, os.path.join(pkg_in, 'Data/com.apple.CoreML/weights'))
four_bit = onnx_four_bit()
originals, chosen = {}, {}
for function in prog.functions.values():
    for name, op in linear_weights(function).items():
        originals.setdefault(name, op.outputs[0].val.copy())
for name, val in originals.items():
    found = four_bit.get(hashlib.sha256(val.tobytes()).hexdigest())
    if found is not None:
        chosen[name] = found
kept = sorted(set(originals) - set(chosen))
if not chosen:
    raise SystemExit('no matrix is a dequantised ONNX 4-bit matrix')

SUFFIX = {'int4': '_quantized', 'int4-requant': '_quantized', 'pal6': '_palettized'}
UINT4 = types.nptype_from_builtin(types.uint4)


@block_context_manager
def write_onnx_codes(block):
    for op in list(block.operations):
        if op.op_type != 'const' or op.name not in chosen:
            continue
        codes, zeros, scales = chosen[op.name]
        new = mb.constexpr_blockwise_shift_scale(
            data=codes.astype(UINT4), scale=scales.astype(np.float16), offset=zeros.astype(UINT4),
            before_op=op, name=op.name + SUFFIX[scheme])
        block.replace_uses_of_var_after_op(anchor_op=op, old_var=op.outputs[0], new_var=new)
        block.remove_ops([op])


if scheme == 'int4':
    for function in prog.functions.values():
        write_onnx_codes(function)
else:
    config = (OpLinearQuantizerConfig(mode='linear', dtype='uint4', granularity='per_block', block_size=BLOCK,
                                      weight_threshold=0) if scheme == 'int4-requant'
              else OpPalettizerConfig(mode='kmeans', nbits=6, granularity='per_tensor', weight_threshold=0))
    graph_pass = PASS_REGISTRY['compression::linear_quantize_weights' if scheme == 'int4-requant'
                               else 'compression::palettize_weights']
    graph_pass.set_options([
        PassOption('config', OptimizationConfig(op_name_configs={name: config for name in chosen})),
        PassOption('joint_compression', False),
    ])
    graph_pass.apply(prog)
PASS_REGISTRY['common::const_deduplication']._deduplicate_const_across_functions(prog)

first = next(iter(prog.functions.values()))
rebuilt = {op.name: op for op in first.operations if op.op_type.startswith('constexpr_')}
matrices = []
for name in sorted(chosen):
    op = rebuilt.get(name + SUFFIX[scheme])
    if op is None:
        raise SystemExit(f'{name} was not compressed')
    new = np.asarray(op.materialized_val_inference(), dtype=np.float16).astype(np.float32)
    old = originals[name].astype(np.float32)
    diff = np.abs(new - old)
    matrices.append({'name': name, 'shape': list(old.shape), 'changed': float((diff > 0).mean()),
                     'maxAbs': float(diff.max()),
                     'relativeL2': float(np.linalg.norm(new - old) / (np.linalg.norm(old) + 1e-30))})

prog.default_function_name = spec.description.defaultFunctionName
prog.skip_all_passes = True
prog.export_as_multifunction = True
model = mil_convert(prog, convert_to='mlprogram', convert_from='milinternal',
                    specification_version=spec.specificationVersion, compute_units=ct.ComputeUnit.CPU_ONLY,
                    model_description=spec.description, skip_model_load=True)
model.save(pkg_out)

report = {
    'scheme': scheme, 'coremltools': ct.__version__, 'numpy': np.__version__, 'onnx': onnx.__version__,
    'compressed': len(chosen), 'keptFp16': kept,
    'weightBinBytes': os.path.getsize(os.path.join(pkg_out, 'Data/com.apple.CoreML/weights/weight.bin')),
    'worst': {key: max(m[key] for m in matrices) for key in ('changed', 'maxAbs', 'relativeL2')},
    'matrices': matrices,
}
json.dump(report, open(report_path, 'w'), indent=1)
print(json.dumps({k: v for k, v in report.items() if k != 'matrices'}))
