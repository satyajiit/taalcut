// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A fake onnxruntime for the listen sessions (EAR1-F7 tests): no model files, no GPU; it logs every session. */
import type { ListenOrt } from '../../src/listen/models/ort';

class FakeTensor {
  constructor(
    readonly type: string,
    readonly data: Float32Array | BigInt64Array,
    readonly dims: readonly number[],
  ) {}
  dispose(): void {}
}

export interface OrtLog {
  readonly opened: string[];
  readonly released: string[];
}

/** Model files are paths, the front-end graphs bytes; every session opens on the first provider asked. */
export function fakeOrt(log: OrtLog): ListenOrt {
  return {
    Tensor: FakeTensor as unknown as ListenOrt['Tensor'],
    InferenceSession: {
      async create(model, options) {
        const provider = options?.executionProviders?.[0];
        const name = typeof provider === 'string' ? provider : (provider?.name ?? 'cpu');
        const label = `${typeof model === 'string' ? model.split('/').at(-2) : 'graph'}@${name}`;
        log.opened.push(label);
        return {
          outputNames: ['out'],
          async run(feeds: Readonly<Record<string, unknown>>) {
            const first = Object.values(feeds)[0] as FakeTensor;
            const batch = first.dims[0] ?? 1;
            if ('frames' in feeds) return { out: { data: new Float32Array(batch * 128) } };
            if ('input_values' in feeds) return { logits: { data: new Float32Array(batch * 527) } };
            return { audio_embeds: { data: new Float32Array(batch * 512).fill(1) } };
          },
          async release() {
            log.released.push(label);
          },
        };
      },
    },
  };
}
