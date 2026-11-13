// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A deterministic stand-in for EmbeddingGemma 2: words hash into a bag of
 * words, frames into their colour, so tests can check plumbing (batches,
 * order, prefixes, devices, failures) without weights.
 */
import type {
  EmbeddingDevice,
  EmbeddingImage,
  EmbeddingModel,
  EmbeddingModelLoader,
  EmbeddingModelOptions,
} from '../../src/embed/model';

export interface FakeCall {
  readonly device: EmbeddingDevice;
  readonly kind: 'texts' | 'images';
  readonly inputs: readonly string[];
}

export interface FakeLoaderOptions {
  readonly failOn?: readonly EmbeddingDevice[];
  /** Throw from the model call (not the load). */
  readonly failRun?: boolean;
  /** Return one vector too few. */
  readonly short?: boolean;
  readonly delayMs?: number;
}

const WIDTH = 768;

function hash(word: string): number {
  let h = 2166136261;
  for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h) % (WIDTH - 8);
}

export function textVector(text: string): Float32Array {
  const v = new Float32Array(WIDTH);
  const body = text.replace(/^(task: search result \| query: |title: none \| text: )/, '');
  for (const word of body.toLowerCase().split(/\W+/).filter(Boolean)) v[8 + hash(word)]! += 1;
  v[0] = 0.01;
  return v;
}

export function imageVector(image: EmbeddingImage): Float32Array {
  const v = new Float32Array(WIDTH);
  let r = 0;
  let g = 0;
  let b = 0;
  const n = image.width * image.height;
  for (let i = 0; i < n; i++) {
    r += image.rgb[i * 3] ?? 0;
    g += image.rgb[i * 3 + 1] ?? 0;
    b += image.rgb[i * 3 + 2] ?? 0;
  }
  v[1] = r / n / 255 + 0.01;
  v[2] = g / n / 255 + 0.01;
  v[3] = b / n / 255 + 0.01;
  return v;
}

export function fakeLoader(options: FakeLoaderOptions = {}): EmbeddingModelLoader & {
  calls: FakeCall[];
  loads: string[];
  options: (EmbeddingModelOptions | undefined)[];
} {
  const calls: FakeCall[] = [];
  const loads: string[] = [];
  const loadOptions: (EmbeddingModelOptions | undefined)[] = [];
  const wait = () => new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));
  const loader = async (
    dir: string,
    device: EmbeddingDevice,
    modelOptions?: EmbeddingModelOptions,
  ): Promise<EmbeddingModel> => {
    loads.push(`${device}:${dir}`);
    loadOptions.push(modelOptions);
    if (options.failOn?.includes(device)) throw new Error(`${device} session failed`);
    return {
      device,
      async embedTexts(texts) {
        calls.push({ device, kind: 'texts', inputs: [...texts] });
        await wait();
        if (options.failRun) throw new Error('run failed');
        const out = texts.map(textVector);
        return options.short ? out.slice(1) : out;
      },
      async embedImages(images) {
        calls.push({
          device,
          kind: 'images',
          inputs: images.map((image) => `${image.width}x${image.height}`),
        });
        await wait();
        if (options.failRun) throw new Error('run failed');
        return images.map(imageVector);
      },
      async dispose() {},
    };
  };
  return Object.assign(loader, { calls, loads, options: loadOptions });
}
