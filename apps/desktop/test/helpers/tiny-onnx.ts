// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A tiny ONNX model written by hand (protobuf, onnx.proto3 field numbers), for a session smoke test with no model
 * download: Y = Relu(X · W), X float[1, n], W an n×n initializer of `weight`. MatMul runs on cuBLAS and Relu on a
 * CUDA kernel, so a CUDA session that refuses CPU fallback proves the GPU path.
 */

function varint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

type Field = readonly number[];
const int = (field: number, value: number): Field => [...varint(field << 3), ...varint(value)];
const bytes = (field: number, data: Uint8Array | readonly number[]): Field => [
  ...varint((field << 3) | 2),
  ...varint(data.length),
  ...data,
];
const text = (field: number, value: string) => bytes(field, [...Buffer.from(value, 'utf8')]);
const message = (field: number, ...fields: Field[]) => bytes(field, fields.flat());

const FLOAT = 1;

/** ValueInfoProto: a float tensor of `dims`. */
function tensorInfo(field: number, name: string, dims: readonly number[]): Field {
  const shape = dims.map((d) => message(1, int(1, d)));
  return message(field, text(1, name), message(2, message(1, int(1, FLOAT), message(2, ...shape))));
}

export function tinyMatMulRelu(n = 256, weight = 0.5): Uint8Array {
  const raw = Buffer.alloc(n * n * 4);
  for (let i = 0; i < n * n; i++) raw.writeFloatLE(weight, i * 4);
  const initializer = message(5, int(1, n), int(1, n), int(2, FLOAT), text(8, 'W'), bytes(9, raw));
  const matmul = message(1, text(1, 'X'), text(1, 'W'), text(2, 'H'), text(3, 'matmul'), text(4, 'MatMul'));
  const relu = message(1, text(1, 'H'), text(2, 'Y'), text(3, 'relu'), text(4, 'Relu'));
  const graph = message(
    7,
    matmul,
    relu,
    text(2, 'tiny'),
    initializer,
    tensorInfo(11, 'X', [1, n]),
    tensorInfo(12, 'Y', [1, n]),
  );
  return Uint8Array.from([...int(1, 8), ...text(2, 'taalcut-test'), ...graph, ...message(8, int(2, 17))]);
}
