// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A tiny ONNX ModelProto writer for in-memory graphs (DSP front-ends, frame
 * statistics). No protobuf dependency: the fields we emit are fixed.
 */

export interface OnnxValue {
  readonly name: string;
  readonly dims: readonly number[];
}

export interface OnnxNode {
  readonly name?: string;
  readonly op: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
}

export interface OnnxGraph {
  readonly name?: string;
  readonly inputs: readonly OnnxValue[];
  readonly outputs: readonly OnnxValue[];
  readonly nodes: readonly OnnxNode[];
}

function varint(value: number): Uint8Array {
  const bytes: number[] = [];
  let rest = value >>> 0;
  while (rest > 127) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  bytes.push(rest);
  return Uint8Array.from(bytes);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function tag(field: number, wire: number, body: Uint8Array): Uint8Array {
  return concat([varint((field << 3) | wire), body]);
}

function fieldVarint(field: number, value: number): Uint8Array {
  return tag(field, 0, varint(value));
}

function fieldBytes(field: number, data: Uint8Array): Uint8Array {
  return tag(field, 2, concat([varint(data.length), data]));
}

function fieldString(field: number, text: string): Uint8Array {
  return fieldBytes(field, new TextEncoder().encode(text));
}

/** ValueInfoProto: name, tensor type FLOAT, shape of dim_value entries. */
function valueInfo(info: OnnxValue): Uint8Array {
  const shape = concat(info.dims.map((dim) => fieldBytes(1, fieldVarint(1, dim))));
  const tensor = concat([fieldVarint(1, 1), fieldBytes(2, shape)]);
  return concat([fieldString(1, info.name), fieldBytes(2, fieldBytes(1, tensor))]);
}

function nodeMessage(node: OnnxNode): Uint8Array {
  return concat([
    ...node.inputs.map((name) => fieldString(1, name)),
    ...node.outputs.map((name) => fieldString(2, name)),
    ...(node.name ? [fieldString(3, node.name)] : []),
    fieldString(4, node.op),
  ]);
}

/** ir_version 8, opset 17 (empty domain), producer `taalcut`. */
export function encodeOnnxModel(graph: OnnxGraph): Uint8Array {
  const graphMessage = concat([
    ...graph.nodes.map((node) => fieldBytes(1, nodeMessage(node))),
    fieldString(2, graph.name ?? 'graph'),
    ...graph.inputs.map((info) => fieldBytes(11, valueInfo(info))),
    ...graph.outputs.map((info) => fieldBytes(12, valueInfo(info))),
  ]);
  const opset = fieldBytes(8, concat([fieldString(1, ''), fieldVarint(2, 17)]));
  return concat([fieldVarint(1, 8), fieldString(2, 'taalcut'), fieldBytes(7, graphMessage), opset]);
}
