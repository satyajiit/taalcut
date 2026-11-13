// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Core ML component's weights written from the ONNX component on first use (IX3-N3), on small made-up files: the
 * fp16 rounding (numpy's: to nearest, ties to even, subnormals), 4-bit matrices, the recipe's three segment kinds,
 * the sha256 check, a component packed before IX3 used as it is, and two processes expanding at once. The real
 * recipe is checked byte for byte when it is packed (weight_recipe.py) and every time it is written.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COREML_EXPANDED,
  COREML_RECIPE,
  coreMlModelsDir,
  describeWrittenWeights,
  parseRecipe,
  type CoreMlRecipe,
  type WrittenCoreMlWeights,
} from '../../src/embed/coreml-weights';
import { dequantiseQ4, halfBits, halfValue } from '../../src/embed/q4-weights';

// The real file system, with `open` and `statfs` replaceable per test (IX3-F5: short writes, a failed statfs).
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof fsp>();
  return { ...real, open: vi.fn(real.open), statfs: vi.fn(real.statfs) };
});
const realFs = await vi.importActual<typeof fsp>('node:fs/promises');

const f16round = (Math as unknown as { f16round: (x: number) => number }).f16round;

describe('fp16 rounding', () => {
  it('reads fp16 bit patterns', () => {
    expect(halfValue(0x3c00)).toBe(1);
    expect(halfValue(0x0001)).toBe(2 ** -24);
    expect(halfValue(0x7bff)).toBe(65504);
    expect(Object.is(halfValue(0x8000), -0)).toBe(true);
    expect(halfValue(0xc000)).toBe(-2);
  });

  it('rounds float32 values as numpy does: to nearest, ties to even, through the subnormals', () => {
    expect(halfBits(1 + 2 ** -11)).toBe(0x3c00); // a tie: to the even 1
    expect(halfBits(1 + 3 * 2 ** -11)).toBe(0x3c02); // a tie: up to the even mantissa
    expect(halfBits(2 ** -25)).toBe(0); // half the smallest subnormal: to the even 0
    expect(halfBits(3 * 2 ** -25)).toBe(2); // 1.5 subnormal steps: to 2
    expect(halfBits(65520)).toBe(0x7c00); // past the largest: infinity
    expect(halfBits(-0)).toBe(0x8000);
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 20000; i += 1) {
      const value = Math.fround((random() - 0.5) * 2 ** Math.floor(random() * 44 - 30));
      expect(halfValue(halfBits(value))).toBe(f16round(value));
    }
  });
});

describe('dequantiseQ4', () => {
  it('writes fp16(scale × (code − zero)) per block of a row, zero points 8 when there are none', () => {
    // 2 rows × 4 columns in blocks of 2: codes row 0 = 1, 2, 3, 4; row 1 = 15, 0, 8, 9.
    const codes = Uint8Array.from([0x21, 0x43, 0x0f, 0x98]);
    const scales = Float32Array.from([0.5, 0.25, -1, 0.1]);
    const zeros = Uint8Array.from([0x31, 0x08]); // row 0: 1, 3; row 1: 8, 0
    const got = Array.from(dequantiseQ4({ rows: 2, columns: 4, block: 2, codes, scales, zeros }), halfValue);
    expect(got).toEqual([
      0,
      0.5,
      0,
      0.25,
      -7,
      8,
      f16round(Math.fround(8 * Math.fround(0.1))),
      f16round(Math.fround(9 * Math.fround(0.1))),
    ]);
    const eights = Array.from(
      dequantiseQ4({
        rows: 1,
        columns: 2,
        block: 2,
        codes: Uint8Array.from([0x9f]),
        scales: Float32Array.from([2]),
        zeros: null,
      }),
      halfValue,
    );
    expect(eights).toEqual([14, 2]);
  });
});

interface Fixture {
  readonly component: string;
  readonly onnx: string;
  readonly expected: Buffer;
  readonly recipe: CoreMlRecipe;
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'coreml-weights-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * A component whose weight.bin is 8 raw bytes, a 2 × 64 matrix from 4-bit codes (float32 scales, blocks of 32), 6
 * bytes copied from the ONNX data, then 4 raw bytes; and the ONNX data file it reads.
 */
async function fixture(options: { sha?: string; onnxBytes?: number } = {}): Promise<Fixture> {
  const component = join(root, 'component');
  const onnx = join(root, 'onnx');
  await mkdir(join(component, 'M.mlmodelc'), { recursive: true });
  await mkdir(join(onnx, 'onnx'), { recursive: true });
  await writeFile(join(component, 'M.mlmodelc', 'model.mil'), 'program(1.3)');
  await writeFile(join(component, 'position_embeddings.f16'), Buffer.from([1, 2]));
  const raw = Buffer.from('HEADER..TAIL');
  await writeFile(join(component, 'weights.raw'), raw);
  const codes = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37) % 256));
  const scales = Buffer.from(Float32Array.from([0.01, -0.02, 0.5, 1e-6]).buffer);
  const zeros = Buffer.from([0x74, 0x0f]);
  const copied = Buffer.from('COPIED');
  const data = Buffer.concat([Buffer.from('pad!'), codes, scales, zeros, copied]);
  await writeFile(join(onnx, 'onnx', 'model.onnx_data'), data);
  const half = dequantiseQ4({
    rows: 2,
    columns: 64,
    block: 32,
    codes,
    scales: new Float32Array(scales.buffer, scales.byteOffset, 4),
    zeros,
  });
  const expected = Buffer.concat([raw.subarray(0, 8), Buffer.from(half.buffer), copied, raw.subarray(8)]);
  const recipe: CoreMlRecipe = {
    version: 1,
    sources: { text: { path: 'onnx/model.onnx_data', bytes: options.onnxBytes ?? data.length } },
    raw: { path: 'weights.raw', bytes: raw.length },
    files: [
      {
        path: 'M.mlmodelc/weights/weight.bin',
        bytes: expected.length,
        sha256: options.sha ?? createHash('sha256').update(expected).digest('hex'),
        segments: [
          ['raw', 0, 8],
          ['q4', 2, 64, 32, 'f32', ['text', 4], ['text', 68], ['text', 84]],
          ['copy', 'text', 86, 6],
          ['raw', 8, 4],
        ],
      },
    ],
  };
  await writeFile(join(component, COREML_RECIPE), JSON.stringify(recipe));
  return { component, onnx, expected, recipe };
}

describe('coreMlModelsDir', () => {
  it('uses a component packed with its weights as it is', async () => {
    const component = join(root, 'old');
    await mkdir(join(component, 'M.mlmodelc', 'weights'), { recursive: true });
    expect(await coreMlModelsDir(component, join(root, 'onnx'))).toEqual({ ok: true, value: component });
    expect(existsSync(join(component, COREML_EXPANDED))).toBe(false);
  });

  it('writes the recipe’s files beside a copy of the component’s own, once', async () => {
    const { component, onnx, expected } = await fixture();
    const dir = join(component, COREML_EXPANDED);
    expect(await coreMlModelsDir(component, onnx)).toEqual({ ok: true, value: dir });
    expect(await readFile(join(dir, 'M.mlmodelc', 'weights', 'weight.bin'))).toEqual(expected);
    expect(await readFile(join(dir, 'M.mlmodelc', 'model.mil'), 'utf8')).toBe('program(1.3)');
    expect(existsSync(join(dir, 'position_embeddings.f16'))).toBe(true);
    expect(existsSync(join(dir, COREML_RECIPE)) || existsSync(join(dir, 'weights.raw'))).toBe(false);
    const written = (await stat(join(dir, 'M.mlmodelc', 'weights', 'weight.bin'))).mtimeMs;
    expect(await coreMlModelsDir(component, onnx)).toEqual({ ok: true, value: dir });
    expect((await stat(join(dir, 'M.mlmodelc', 'weights', 'weight.bin'))).mtimeMs).toBe(written);
  });

  it('reports a write with each file it checked, and nothing for a folder already written', async () => {
    const { component, onnx, recipe } = await fixture();
    const heard: WrittenCoreMlWeights[] = [];
    await coreMlModelsDir(component, onnx, (written) => heard.push(written));
    await coreMlModelsDir(component, onnx, (written) => heard.push(written));
    expect(heard).toHaveLength(1);
    const file = recipe.files[0];
    expect(heard[0]?.dir).toBe(join(component, COREML_EXPANDED));
    expect(heard[0]?.files).toEqual([{ path: file?.path, bytes: file?.bytes, sha256: file?.sha256 }]);
    expect(heard[0]?.ms).toBeGreaterThanOrEqual(0);
    expect(describeWrittenWeights(heard[0] as WrittenCoreMlWeights)).toMatch(
      new RegExp(
        `^Core ML weights written from the recipe into .+ in \\d+ ms \\(0\\.0 MB\\): M\\.mlmodelc/weights/weight\\.bin sha256 ${file?.sha256.slice(0, 12)} ok$`,
      ),
    );
  });

  it('refuses bytes that are not the recipe’s and leaves nothing behind', async () => {
    const { component, onnx } = await fixture({ sha: 'a'.repeat(64) });
    const result = await coreMlModelsDir(component, onnx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('M.mlmodelc/weights/weight.bin');
    expect((await readdir(component)).filter((n) => n.startsWith(COREML_EXPANDED))).toEqual([]);
  });

  it('refuses an ONNX component the recipe was not made from', async () => {
    const { component, onnx } = await fixture({ onnxBytes: 5 });
    const result = await coreMlModelsDir(component, onnx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('the recipe was made from 5');
  });

  it('writes a damaged expansion again', async () => {
    const { component, onnx, expected } = await fixture();
    const dir = join(component, COREML_EXPANDED);
    await coreMlModelsDir(component, onnx);
    await rm(join(dir, 'M.mlmodelc', 'weights', 'weight.bin'));
    expect(await coreMlModelsDir(component, onnx)).toEqual({ ok: true, value: dir });
    expect(await readFile(join(dir, 'M.mlmodelc', 'weights', 'weight.bin'))).toEqual(expected);
  });

  it('gives two callers at once the same complete folder', async () => {
    const { component, onnx, expected } = await fixture();
    const both = await Promise.all([coreMlModelsDir(component, onnx), coreMlModelsDir(component, onnx)]);
    expect(both).toEqual([
      { ok: true, value: join(component, COREML_EXPANDED) },
      { ok: true, value: join(component, COREML_EXPANDED) },
    ]);
    expect(await readFile(join(component, COREML_EXPANDED, 'M.mlmodelc', 'weights', 'weight.bin'))).toEqual(
      expected,
    );
    expect((await readdir(component)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});

describe('coreMlModelsDir on a volume that misbehaves (IX3-F5)', () => {
  afterEach(() => {
    vi.mocked(fsp.open).mockImplementation(realFs.open);
    vi.mocked(fsp.statfs).mockImplementation(realFs.statfs);
  });
  const leftovers = async (component: string) =>
    (await readdir(component)).filter((n) => n.startsWith(COREML_EXPANDED));
  /** Every handle opened for writing passes its writes through `write`. */
  const writesThrough = (
    write: (handle: fsp.FileHandle, bytes: Uint8Array) => Promise<{ bytesWritten: number }>,
  ) =>
    vi.mocked(fsp.open).mockImplementation(async (...args: Parameters<typeof realFs.open>) => {
      const handle = await realFs.open(...args);
      if (args[1] !== 'w') return handle;
      return new Proxy(handle, {
        get: (target, key) => {
          if (key === 'write')
            return (bytes: Uint8Array, offset = 0, length = bytes.length - offset) =>
              write(target, bytes.subarray(offset, offset + length));
          const value: unknown = Reflect.get(target, key);
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
    });

  it('writes every byte when the volume takes a few at a time (H2)', async () => {
    writesThrough((handle, bytes) => handle.write(bytes, 0, Math.min(3, bytes.length)));
    const { component, onnx, expected } = await fixture();
    const dir = join(component, COREML_EXPANDED);
    expect(await coreMlModelsDir(component, onnx)).toEqual({ ok: true, value: dir });
    expect(await readFile(join(dir, 'M.mlmodelc', 'weights', 'weight.bin'))).toEqual(expected);
  });

  it('checks what reached the disk before moving it into place, and leaves nothing on a mismatch (H2)', async () => {
    // A write that says it took every byte but stored one wrong: only reading the file back can tell.
    writesThrough(async (handle, bytes) => {
      const stored = Uint8Array.from(bytes);
      if (stored.length > 0) stored[0] = (stored[0] ?? 0) ^ 0xff;
      return handle.write(stored, 0, stored.length);
    });
    const { component, onnx } = await fixture();
    const result = await coreMlModelsDir(component, onnx);
    expect(!result.ok && result.error).toMatch(/weight\.bin reads back as \d+ bytes, sha256/);
    expect(await leftovers(component)).toEqual([]);
  });

  it('writes nothing when the free space can’t be read, so the caller stays on ONNX (M1)', async () => {
    vi.mocked(fsp.statfs).mockRejectedValue(new Error('EIO: statfs'));
    const { component, onnx } = await fixture();
    const result = await coreMlModelsDir(component, onnx);
    expect(!result.ok && result.error).toContain('could not read the free space');
    expect(await leftovers(component)).toEqual([]);
  });
});

describe('parseRecipe', () => {
  it('refuses paths outside the folder and sources it does not list', async () => {
    const { recipe } = await fixture();
    const escaping = { ...recipe, raw: { ...recipe.raw, path: '../weights.raw' } };
    expect(parseRecipe(JSON.stringify(escaping)).ok).toBe(false);
    const file = recipe.files[0];
    if (!file) throw new Error('no file');
    const unlisted = { ...recipe, files: [{ ...file, segments: [['copy', 'vision', 0, 1]] }] };
    const parsed = parseRecipe(JSON.stringify(unlisted));
    expect(parsed.ok ? '' : parsed.error).toContain('reads vision');
    expect(parseRecipe('{').ok).toBe(false);
  });
});
