# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# The `embeddinggemma-2-coreml` component's weights (IX2-E3): FluidInference's Core ML packages of EmbeddingGemma 2
# (the same graphs, fp16) with the weights of the ONNX component Taalcut ships (onnx-community's q4 text graph and
# q4f16 vision graph) written into them, so the Core ML vectors match the ONNX path's (cosine >= 0.999; vision SPEC
# "Core ML backend"). Usage, from pack-embeddinggemma-coreml.sh:
#
#   q4_surgery.py <onnxDir> <fluidDir> <outDir>
#
# Reads <onnxDir>/onnx/model_q4.onnx(+_data) and vision_encoder_q4f16.onnx(+_data); copies the two .mlpackage
# folders from <fluidDir> into <outDir> and rewrites each fp16 weight blob in place (same size, same offset) with the
# dequantized ONNX weight it matches (the best correlation among the same-shaped ONNX weights: about 0.996 for every
# one, since both are the same checkpoint; a fused qkv or gate/up matrix is split first). Writes
# <outDir>/embeddings.f16 (the q4 token table, dequantized; the ONNX table already carries Gemma's sqrt(512) scale)
# and <outDir>/position_embeddings.f16 (the q4 x and y position tables, rows 0-1023), and surgery-report.json. Exits
# non-zero when a Core ML weight matrix finds no match (the computed rotary and attention-scale tables aside), an
# ONNX weight goes unused, or a match correlates under 0.99.
import os, re, shutil, struct, sys, json
import numpy as np, onnx
from onnx import numpy_helper
from coremltools.proto import Model_pb2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # run with -I: onnx_q4.py sits beside this file
from onnx_q4 import dequantise, gather_codes, matmulnbits_codes

onnx_dir, fluid_dir, out_dir = sys.argv[1:4]
report = {"text": [], "vision": []}

def load_inits(path):
    m = onnx.load(path, load_external_data=True)
    return m, {i.name: i for i in m.graph.initializer}

def matmulnbits(inits, node):
    return dequantise(*matmulnbits_codes(inits, node))  # [N, K]: y = x @ w.T

def gatherbq(inits, node):
    return dequantise(*gather_codes(inits, node))  # [rows, cols]

def mil_consts(spec):
    """name -> (shape, offset) of every blob-backed fp16 const, from the first function (all share the blobs)."""
    out = {}
    for fname, fn in spec.mlProgram.functions.items():
        block = fn.block_specializations[fn.opset]
        for op in block.operations:
            if op.type != 'const':
                continue
            v = op.attributes.get('val')
            if v is None or not v.HasField('blobFileValue'):
                continue
            t = v.type.tensorType
            out.setdefault(op.outputs[0].name, ([d.constant.size for d in t.dimensions], v.blobFileValue.offset, t.dataType))
    return out

def blob_data_offset(f, meta_offset):
    f.seek(meta_offset)
    sentinel, dtype, size, data_offset = struct.unpack('<IIQQ', f.read(24))
    assert sentinel == 0xDEADBEEF, hex(sentinel)
    return dtype, size, data_offset

def read_fp16(f, meta_offset, shape):
    dtype, size, off = blob_data_offset(f, meta_offset)
    f.seek(off)
    return np.frombuffer(f.read(size), dtype=np.float16).reshape(shape), off, size

def corr(a, b):
    a = a.astype(np.float64).ravel(); b = b.astype(np.float64).ravel()
    a -= a.mean(); b -= b.mean()
    return float((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum() + 1e-30))

def patch_package(pkg_src, pkg_dst, candidates, kind):
    shutil.copytree(pkg_src, pkg_dst, dirs_exist_ok=True)
    spec = Model_pb2.Model()
    spec.ParseFromString(open(os.path.join(pkg_dst, 'Data/com.apple.CoreML/model.mlmodel'), 'rb').read())
    consts = mil_consts(spec)
    weights = os.path.join(pkg_dst, 'Data/com.apple.CoreML/weights/weight.bin')
    used = set()
    with open(weights, 'r+b') as f:
        for name, (shape, meta, dtype) in sorted(consts.items(), key=lambda kv: kv[1][1]):
            if len(shape) != 2 or dtype != 10:  # fp16 matrices only
                continue
            orig, off, size = read_fp16(f, meta, shape)
            best = None
            flat = orig.ravel()
            pick = np.random.default_rng(0).choice(flat.size, min(flat.size, 20000), replace=False)
            for key, w in candidates.items():
                if key in used or tuple(w.shape) != tuple(shape):
                    continue
                c = corr(flat[pick], w.ravel()[pick])
                if best is None or c > best[1]:
                    best = (key, c)
            if best is not None:
                best = (best[0], corr(orig, candidates[best[0]]))
                # Folded scales: the per-column least-squares ratio of the original to ours.
                w = candidates[best[0]].astype(np.float64); o = orig.astype(np.float64)
                col = (o * w).sum(0) / ((w * w).sum(0) + 1e-30)
                row = (o * w).sum(1) / ((w * w).sum(1) + 1e-30)
                fold = (float(np.median(col)), float(np.percentile(col, 1)), float(np.percentile(col, 99)),
                        float(np.percentile(row, 1)), float(np.percentile(row, 99)))
            if best is None or best[1] < 0.9:
                report[kind].append({"const": name, "shape": shape, "match": None, "corr": best[1] if best else None})
                continue
            used.add(best[0])
            new = candidates[best[0]].astype(np.float16)
            assert new.nbytes == size
            f.seek(off); f.write(new.tobytes())
            report[kind].append({"const": name, "shape": shape, "match": best[0], "corr": round(best[1], 5),
                                 "colRatio": [round(x, 4) for x in fold[:3]], "rowRatio": [round(x, 4) for x in fold[3:]],
                                 "maxAbsChange": float(np.abs(new.astype(np.float32) - orig.astype(np.float32)).max())})
    unused = [k for k in candidates if k not in used]
    return unused

os.makedirs(out_dir, exist_ok=True)

# Text: every MatMulNBits, fused qkv split into q/k/v rows.
tm, ti = load_inits(os.path.join(onnx_dir, 'onnx/model_q4.onnx'))
text = {}
for n in tm.graph.node:
    if n.op_type == 'MatMulNBits':
        w = matmulnbits(ti, n)
        if 'qkv_proj' in n.name:
            qn = w.shape[0] - 1024  # q rows; k and v are 512 each (2048 q rows on full-attention layers)
            q, k, v = w[:qn], w[qn:qn + 512], w[qn + 512:]
            for part, sub in (('q', q), ('k', k), ('v', v)):
                text[f"{n.name}#{part}"] = sub
        elif w.shape[0] == 4096 and 'gate_up' in n.name:
            text[f"{n.name}#gate"], text[f"{n.name}#up"] = w[:2048], w[2048:]
        else:
            text[n.name] = w
    if n.op_type == 'GatherBlockQuantized':
        table = gatherbq(ti, n)
        table.astype(np.float16).tofile(os.path.join(out_dir, 'embeddings.f16'))
        print('token table', table.shape, 'absmax', float(np.abs(table).max()))
unused = patch_package(os.path.join(fluid_dir, 'EmbeddingGemma2Text.mlpackage'),
                       os.path.join(out_dir, 'EmbeddingGemma2Text.mlpackage'), text, 'text')
leftover = list(unused)
print('text: matched', sum(1 for r in report['text'] if r['match']), 'unmatched consts',
      [r['const'] for r in report['text'] if not r['match']], 'unused onnx', unused)

# Vision: every MatMulNBits; the x/y position tables.
vm, vi = load_inits(os.path.join(onnx_dir, 'onnx/vision_encoder_q4f16.onnx'))
vision = {}
tables = []
for n in vm.graph.node:
    if n.op_type == 'MatMulNBits':
        vision[n.name] = matmulnbits(vi, n)
    if n.op_type == 'GatherBlockQuantized':
        tables.append(gatherbq(vi, n))
for name in vi:
    a = numpy_helper.to_array(vi[name])
    if a.ndim == 2 and a.dtype in (np.float16, np.float32) and min(a.shape) >= 256:
        vision[name] = a.astype(np.float32)
unused = patch_package(os.path.join(fluid_dir, 'EmbeddingGemma2Vision.mlpackage'),
                       os.path.join(out_dir, 'EmbeddingGemma2Vision.mlpackage'), vision, 'vision')
leftover += unused
print('vision: matched', sum(1 for r in report['vision'] if r['match']), 'unmatched consts',
      [r['const'] for r in report['vision'] if not r['match']], 'unused onnx', unused)
pos = np.stack([t[:1024] for t in tables])  # [2, 1024, 768]
ref = np.fromfile(os.path.join(fluid_dir, 'position_embeddings.f16'), dtype=np.float16).reshape(2, 1024, 768)
print('position tables corr to fluid', [round(corr(pos[i], ref[i]), 5) for i in range(2)])
pos.astype(np.float16).tofile(os.path.join(out_dir, 'position_embeddings.f16'))
json.dump(report, open(os.path.join(out_dir, 'surgery-report.json'), 'w'), indent=1)
lows = [r for k in report for r in report[k] if r['match'] and r['corr'] < 0.99]
print('matches under 0.99 corr:', lows[:10])

# The rotary tables and attention-scale constants are computed, not trained: they have no ONNX weight and stay.
COMPUTED = re.compile(r'^(cos|sin)(_\d+)?_to_fp16$|^inv_(full|sliding)_attention_to_fp16$')
unmatched = [r['const'] for k in report for r in report[k] if not r['match'] and not COMPUTED.match(r['const'])]
if unmatched or leftover or lows:
    raise SystemExit(f'surgery incomplete: unmatched {unmatched[:10]}, unused onnx {leftover[:10]}, low {lows[:10]}')
