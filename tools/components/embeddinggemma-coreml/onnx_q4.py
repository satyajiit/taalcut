# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# The ONNX component's 4-bit weights, read the way onnxruntime reads them (MatMulNBits and GatherBlockQuantized,
# asymmetric blocks along the input channel): shared by q4_surgery.py, compress_weights.py and token_table.py.
# Those run with `python -I`, which leaves this folder off sys.path, so each puts it back itself (the folder holds
# only these tools).
import numpy as np
import onnx
from onnx import numpy_helper


def unpack4(a):
    """Two 4-bit values a byte, the low nibble first."""
    a = np.asarray(a, dtype=np.uint8)
    return np.stack([a & 0x0F, a >> 4], axis=-1).reshape(*a.shape[:-1], a.shape[-1] * 2)


def attributes(node):
    return {a.name: onnx.helper.get_attribute_value(a) for a in node.attribute}


def matmulnbits_codes(inits, node):
    """A MatMulNBits weight for y = x @ w.T: (codes [N, K], zero points [N, blocks], float32 scales [N, blocks],
    block size). Without a zero-point input the zero point is 8."""
    attrs = attributes(node)
    k, n, block = attrs['K'], attrs['N'], attrs['block_size']
    blocks = (k + block - 1) // block
    codes = unpack4(numpy_helper.to_array(inits[node.input[1]])).reshape(n, -1)[:, :k]
    scales = numpy_helper.to_array(inits[node.input[2]]).astype(np.float32).reshape(n, blocks)
    if len(node.input) > 3 and node.input[3] in inits:
        zeros = unpack4(numpy_helper.to_array(inits[node.input[3]])).reshape(n, -1)[:, :blocks]
    else:
        zeros = np.full((n, blocks), 8, np.uint8)
    return codes, zeros, scales, block


def gather_codes(inits, node):
    """A GatherBlockQuantized table [rows, columns]: (codes, zero points, float32 scales, block size)."""
    block = attributes(node)['block_size']
    codes = unpack4(numpy_helper.to_array(inits[node.input[0]]))
    rows, columns = codes.shape
    blocks = columns // block
    scales = numpy_helper.to_array(inits[node.input[2]]).astype(np.float32).reshape(rows, blocks)
    zeros = unpack4(numpy_helper.to_array(inits[node.input[3]])).reshape(rows, -1)[:, :blocks]
    return codes, zeros, scales, block


def dequantise(codes, zeros, scales, block):
    """float32 (code - zero point) * scale per block, the arithmetic onnxruntime does."""
    rows, columns = codes.shape
    blocks = scales.shape[1]
    w = (codes.reshape(rows, blocks, block).astype(np.float32) - zeros[:, :, None].astype(np.float32)) * scales[:, :, None]
    return w.reshape(rows, blocks * block)[:, :columns]
