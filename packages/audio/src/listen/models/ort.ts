// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The slice of onnxruntime-node the listening models use: media's `OnnxModule` (sessions) plus the Tensor
 * constructor. Audio owns the package (beats/ort-load.ts), so the import starts here. Tests inject a fake.
 */
import type { OnnxModule } from '@taalcut/media';

export type ListenTensorType = 'float32' | 'int64';

export interface ListenTensor {
  readonly data: ArrayLike<number | bigint>;
  readonly dims?: readonly number[];
  dispose?(): void;
}

export interface ListenOrt extends OnnxModule {
  Tensor: new (
    type: ListenTensorType,
    data: Float32Array | BigInt64Array,
    dims: readonly number[],
  ) => unknown;
}

export const loadListenOrt = async (): Promise<ListenOrt> =>
  (await import('onnxruntime-node')) as unknown as ListenOrt;

export function isTensor(value: unknown): value is ListenTensor {
  return typeof value === 'object' && value !== null && 'data' in value;
}

/** A float output as Float32Array, or undefined when the graph didn't produce it. */
export function floatOutput(
  outputs: Readonly<Record<string, unknown>>,
  name: string,
): Float32Array | undefined {
  const tensor = outputs[name] ?? Object.values(outputs)[0];
  if (!isTensor(tensor)) return undefined;
  const { data } = tensor;
  if (data instanceof Float32Array) return data;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = Number(data[i] ?? 0);
  return out;
}

export function disposeAll(feeds: Readonly<Record<string, unknown>>): void {
  for (const tensor of Object.values(feeds)) if (isTensor(tensor)) tensor.dispose?.();
}
