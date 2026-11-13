# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# The `embeddinggemma-2-coreml` component without its weights (IX3-N3): every 4-bit weight matrix q4_surgery.py
# wrote into the Core ML graphs is the fp16 dequantised copy of a matrix the `embeddinggemma-2` component (which the
# Core ML one depends on, and every Mac that has it has) already holds as 4-bit codes. So the component ships a recipe
# instead of the weights, and the app writes today's files from the ONNX component on first use (vision
# embed/coreml-weights.ts): the same bytes, checked by sha256, so the same model, vectors and speed.
#
#   weight_recipe.py <onnxDir> <stageDir>
#
# <stageDir> is pack-embeddinggemma-coreml.sh's compiled stage: EmbeddingGemma2Text.mlmodelc and
# EmbeddingGemma2Vision.mlmodelc with their fp16 weights/weight.bin, embeddings.q4 (token_table.py) and
# position_embeddings.f16. Writes <stageDir>/weights.json and weights.raw, rebuilds every file the recipe names from
# them and the ONNX component and checks its sha256, then removes those files from the stage.
#
# weights.json: {version 1, sources {name: {path (in the ONNX component), bytes}}, raw {path, bytes},
# files [{path, bytes, sha256, segments}]}. A file is its segments in order:
#   ["raw", offset, length]                 bytes of weights.raw (blob headers, padding, weights with no ONNX copy)
#   ["copy", source, offset, length]        bytes of an ONNX data file as they are
#   ["q4", rows, columns, block, "f32"|"f16", codes, scales, zeros]
#       an fp16 matrix [rows, columns], row-major: fp16(scale * (code - zero)) with the product in float32 (what
#       q4_surgery.py wrote). codes, scales and zeros are [source, offset]: rows of columns/2 bytes (two 4-bit codes a
#       byte, the low nibble first), of columns/block scales, and of ceil(blocks/2) bytes of 4-bit zero points (the
#       low nibble first); zeros null means 8 for every block.
# A weight.bin is Core ML's blob file: a 64-byte header, then per blob 64 bytes of metadata (0xDEADBEEF, data type,
# size, offset) and its data at a 64-byte aligned offset.
import hashlib, json, os, struct, sys
import numpy as np, onnx

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # run with -I: onnx_q4.py sits beside this file
from onnx_q4 import attributes, dequantise, gather_codes, matmulnbits_codes

onnx_dir, stage = sys.argv[1:3]
GRAPHS = {'text': 'onnx/model_q4.onnx', 'vision': 'onnx/vision_encoder_q4f16.onnx'}
TEXT_WEIGHTS = 'EmbeddingGemma2Text.mlmodelc/weights/weight.bin'
VISION_WEIGHTS = 'EmbeddingGemma2Vision.mlmodelc/weights/weight.bin'
TABLE = 'embeddings.q4'


def sha(b):
    return hashlib.sha256(b).hexdigest()


def external(init):
    """(file name, offset, length) of an initializer stored in an external data file, else None."""
    if init.data_location != onnx.TensorProto.EXTERNAL:
        return None
    info = {e.key: e.value for e in init.external_data}
    return info['location'], int(info.get('offset', 0)), int(info['length'])


sources, places, q4, copies = {}, {}, {}, {}
for name, graph in GRAPHS.items():
    path = os.path.join(onnx_dir, graph)
    bare = onnx.load(path, load_external_data=False)
    files = {external(i)[0] for i in bare.graph.initializer if external(i)}
    assert len(files) == 1, files
    data = os.path.join(os.path.dirname(graph), files.pop())
    sources[name] = {'path': data, 'bytes': os.path.getsize(os.path.join(onnx_dir, data))}
    for init in bare.graph.initializer:
        at = external(init)
        if at:
            places[init.name] = (name, at[1], at[2])
    full = onnx.load(path, load_external_data=True)
    inits = {i.name: i for i in full.graph.initializer}
    blob = open(os.path.join(onnx_dir, data), 'rb').read()
    for init_name, (src, offset, length) in places.items():
        if src == name:
            copies.setdefault(sha(blob[offset:offset + length]), [src, offset, length])
    for node in full.graph.node:
        if node.op_type != 'MatMulNBits':
            continue
        codes, zeros, scales, block = matmulnbits_codes(inits, node)
        rows, columns = codes.shape
        blocks = scales.shape[1]
        assert columns % block == 0 and columns == blocks * block, (node.name, codes.shape, block)
        weight = dequantise(codes, zeros, scales, block).astype(np.float16)
        scale_type = {np.dtype('float32'): 'f32', np.dtype('float16'): 'f16'}[
            np.dtype(onnx.helper.tensor_dtype_to_np_dtype(inits[node.input[2]].data_type))]
        scale_bytes = 4 if scale_type == 'f32' else 2
        code_place, scale_place = places[node.input[1]], places[node.input[2]]
        zero_place = places.get(node.input[3]) if len(node.input) > 3 and node.input[3] else None
        assert code_place[2] == rows * columns // 2 and scale_place[2] == rows * blocks * scale_bytes, node.name
        zero_row = (blocks + 1) // 2
        assert zero_place is None or zero_place[2] == rows * zero_row, node.name
        # q4_surgery.py splits fused projections into their own Core ML matrices: any row split may be one.
        cuts = [(0, rows)]
        if 'qkv_proj' in node.name:
            q = rows - 1024
            cuts = [(0, q), (q, q + 512), (q + 512, rows)]
        elif rows == 4096 and 'gate_up' in node.name:
            cuts = [(0, 2048), (2048, 4096)]
        for a, b in cuts:
            q4[sha(weight[a:b].tobytes())] = [
                'q4', b - a, columns, block, scale_type,
                [name, code_place[1] + a * columns // 2],
                [name, scale_place[1] + a * blocks * scale_bytes],
                None if zero_place is None else [name, zero_place[1] + a * zero_row],
            ]

raw = bytearray()


def raw_segment(data):
    segment = ['raw', len(raw), len(data)]
    raw.extend(data)
    return segment


def weight_bin(rel):
    """weight.bin's segments: each blob's data from the ONNX component when it holds it, the rest raw."""
    data = open(os.path.join(stage, rel), 'rb').read()
    count, version = struct.unpack_from('<II', data, 0)
    assert version == 2, (rel, version)
    segments, cursor, found = [], 0, {'q4': 0, 'copy': 0, 'raw': 0}
    pending = bytearray()
    for _ in range(count):
        at = 64 if cursor == 0 else cursor + (-cursor % 64)
        sentinel, _dtype, size, offset = struct.unpack_from('<IIQQ', data, at)
        assert sentinel == 0xDEADBEEF and offset >= at + 64, (rel, at, hex(sentinel))
        pending.extend(data[cursor:offset])
        payload = data[offset:offset + size]
        key = sha(payload)
        match = q4.get(key) or (['copy', *copies[key]] if key in copies else None)
        if match:
            if pending:
                segments.append(raw_segment(bytes(pending)))
                pending.clear()
            segments.append(match)
            found[match[0]] += 1
        else:
            pending.extend(payload)
            found['raw'] += 1
        cursor = offset + size
    pending.extend(data[cursor:])
    if pending:
        segments.append(raw_segment(bytes(pending)))
    print(f'{rel}: {count} blobs: {found}')
    return {'path': rel, 'bytes': len(data), 'sha256': sha(data), 'segments': segments}


def token_table():
    """embeddings.q4: token_table.py's 16-byte header, then the ONNX table's codes, scales and zero points."""
    data = open(os.path.join(stage, TABLE), 'rb').read()
    full = onnx.load(os.path.join(onnx_dir, GRAPHS['text']), load_external_data=False)
    (node,) = [n for n in full.graph.node if n.op_type == 'GatherBlockQuantized']
    parts = [places[node.input[0]], places[node.input[2]], places[node.input[3]]]
    segments = [raw_segment(data[:16])] + [['copy', *p] for p in parts]
    assert 16 + sum(p[2] for p in parts) == len(data), 'embeddings.q4 is not the ONNX table as it is'
    return {'path': TABLE, 'bytes': len(data), 'sha256': sha(data), 'segments': segments}


files = [weight_bin(TEXT_WEIGHTS), weight_bin(VISION_WEIGHTS), token_table()]


def rebuild(entry):
    """The file a recipe entry names, from weights.raw and the ONNX component (the app's expansion, in numpy)."""
    out = hashlib.sha256()
    size = 0
    data = {name: np.memmap(os.path.join(onnx_dir, s['path']), dtype=np.uint8, mode='r') for name, s in sources.items()}
    data['raw'] = np.frombuffer(bytes(raw), dtype=np.uint8)
    for segment in entry['segments']:
        if segment[0] == 'raw':
            chunk = bytes(raw[segment[1]:segment[1] + segment[2]])
        elif segment[0] == 'copy':
            chunk = data[segment[1]][segment[2]:segment[2] + segment[3]].tobytes()
        else:
            _, rows, columns, block, scale_type, codes_at, scales_at, zeros_at = segment
            blocks = columns // block
            packed = data[codes_at[0]][codes_at[1]:codes_at[1] + rows * columns // 2].reshape(rows, columns // 2)
            codes = np.stack([packed & 15, packed >> 4], axis=-1).reshape(rows, columns)
            dtype = '<f4' if scale_type == 'f32' else '<f2'
            width = np.dtype(dtype).itemsize
            scales = data[scales_at[0]][scales_at[1]:scales_at[1] + rows * blocks * width].view(dtype)
            scales = scales.astype(np.float32).reshape(rows, blocks)
            if zeros_at is None:
                zeros = np.full((rows, blocks), 8, np.uint8)
            else:
                zero_row = (blocks + 1) // 2
                z = data[zeros_at[0]][zeros_at[1]:zeros_at[1] + rows * zero_row].reshape(rows, zero_row)
                zeros = np.stack([z & 15, z >> 4], axis=-1).reshape(rows, -1)[:, :blocks]
            chunk = dequantise(codes, zeros, scales, block).astype('<f2').tobytes()
        out.update(chunk)
        size += len(chunk)
    return size, out.hexdigest()


for entry in files:
    got = rebuild(entry)
    if got != (entry['bytes'], entry['sha256']):
        raise SystemExit(f"{entry['path']}: the recipe rebuilds {got}, not {(entry['bytes'], entry['sha256'])}")
    print(f"{entry['path']}: rebuilt byte for byte ({entry['bytes']} bytes, {len(entry['segments'])} segments)")

with open(os.path.join(stage, 'weights.raw'), 'wb') as f:
    f.write(raw)
recipe = {'version': 1, 'sources': sources, 'raw': {'path': 'weights.raw', 'bytes': len(raw), 'sha256': sha(raw)},
          'files': files}
with open(os.path.join(stage, 'weights.json'), 'w') as f:
    json.dump(recipe, f, separators=(',', ':'))
for entry in files:
    os.remove(os.path.join(stage, entry['path']))
print(f"weights.raw {len(raw)} bytes, weights.json {os.path.getsize(os.path.join(stage, 'weights.json'))} bytes")
