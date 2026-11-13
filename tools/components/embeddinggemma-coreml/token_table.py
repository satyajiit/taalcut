# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# The text model's token table for the mac helper as 4-bit codes (IX3-N1): `embeddings.q4`, the ONNX component's own
# GatherBlockQuantized table (onnx-community's q4 text graph) instead of embeddings.f16, its dequantised fp16 copy
# (256 MiB, 30% of the component's download). The helper dequantises a row when it reads one, to the same fp16 bytes.
#
#   token_table.py <onnxDir> <outDir>
#
# Layout (little endian), the ONNX tensors' own bytes after a 16-byte header:
#   "TQ4T", uint32 version 1, uint32 rows, uint32 columns (columns a multiple of 64)
#   codes        uint8 [rows][columns / 2]    two 4-bit codes a byte, the even column in the low nibble
#   scales       float32 [rows][columns / 32] one per block of 32 columns
#   zero points  uint8 [rows][columns / 64]   two 4-bit zero points a byte, the even block in the low nibble
# value = fp16(scale * (code - zero point)), the product in float32 (q4_surgery.py's embeddings.f16 is exactly that).
# When <outDir>/embeddings.f16 exists, checks that every row dequantises to its bytes; exits non-zero when one doesn't.
import os, struct, sys
import numpy as np, onnx
from onnx import numpy_helper

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # run with -I: onnx_q4.py sits beside this file
from onnx_q4 import attributes, dequantise, gather_codes

BLOCK = 32
onnx_dir, out_dir = sys.argv[1:3]
model = onnx.load(os.path.join(onnx_dir, 'onnx/model_q4.onnx'), load_external_data=True)
inits = {i.name: i for i in model.graph.initializer}
(node,) = [n for n in model.graph.node if n.op_type == 'GatherBlockQuantized']
attrs = attributes(node)
assert attrs.get('block_size') == BLOCK and attrs.get('bits', 4) == 4, attrs

codes = numpy_helper.to_array(inits[node.input[0]]).astype(np.uint8)
rows, half = codes.shape
columns = half * 2
assert columns % (2 * BLOCK) == 0, columns
scales = numpy_helper.to_array(inits[node.input[2]]).astype('<f4').reshape(rows, columns // BLOCK)
zeros = numpy_helper.to_array(inits[node.input[3]]).astype(np.uint8).reshape(rows, -1)[:, : columns // (2 * BLOCK)]
assert zeros.shape == (rows, columns // (2 * BLOCK)), zeros.shape

path = os.path.join(out_dir, 'embeddings.q4')
with open(path, 'wb') as f:
    f.write(b'TQ4T' + struct.pack('<III', 1, rows, columns))
    f.write(np.ascontiguousarray(codes).tobytes())
    f.write(np.ascontiguousarray(scales).tobytes())
    f.write(np.ascontiguousarray(zeros).tobytes())
print(f'{path}: {rows} rows x {columns}, {os.path.getsize(path)} bytes')

fp16 = os.path.join(out_dir, 'embeddings.f16')
if os.path.exists(fp16):
    want = np.fromfile(fp16, dtype='<f2').reshape(rows, columns)
    got = dequantise(*gather_codes(inits, node)).astype(np.float16)
    if not np.array_equal(got.view(np.uint16), want.view(np.uint16)):
        raise SystemExit('the 4-bit table does not dequantise to embeddings.f16')
    print('every row dequantises to embeddings.f16 byte for byte')
