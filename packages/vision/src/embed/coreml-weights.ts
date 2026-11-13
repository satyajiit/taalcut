// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `embeddinggemma-2-coreml` component's weights, written on first use from the ONNX component (IX3-N3). Every
 * weight matrix of the Core ML graphs is the fp16 copy of a 4-bit matrix the `embeddinggemma-2` component already
 * holds (q4_surgery.py), and the token table is its 4-bit table, so the Core ML component ships a recipe
 * (`weights.json` and `weights.raw`, tools/components/embeddinggemma-coreml/weight_recipe.py) instead of 650 MB of
 * weights. This writes the files the recipe names into `<component>/expanded/` beside a copy of the component's other
 * files: the same bytes as a component packed with its weights (each file's sha256 is checked), so the helper loads
 * the same model and gives the same vectors at the same speed. A component packed before IX3 has no recipe and is
 * used as it is.
 *
 * Recipe segments, in order, make each file: `["raw", offset, length]` of weights.raw; `["copy", source, offset,
 * length]` of an ONNX data file; `["q4", rows, columns, block, "f32" | "f16", codes, scales, zeros]` an fp16 matrix,
 * `fp16(scale × (code − zero))` with the product in float32, from 4-bit codes (two a byte, the low nibble first),
 * a scale per block of columns and 4-bit zero points (null: 8), each a `[source, offset]`.
 *
 * The expansion is written to a temporary folder and renamed into place, so another process (the bench's seed, a
 * second jobs process) either finds it complete or writes its own; it takes a few seconds once per component version.
 */
import { createHash, randomBytes } from 'node:crypto';
import { constants, existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { err, jsonFromText, ok, type AsyncResult, type Result } from '@taalcut/core';
import { z } from 'zod';
import { readBack, writeAll } from './coreml-weights-io';
import { dequantiseQ4, scalesOf } from './q4-weights';

/** The recipe's file name in the component. */
export const COREML_RECIPE = 'weights.json';
/** Where the written component lives, inside the installed one (removed with it). */
export const COREML_EXPANDED = 'expanded';
const MARKER = 'recipe.sha256';
/** Bytes read at a time for raw and copied segments. */
const CHUNK = 16 * 1024 * 1024;
/** A temporary folder older than this is a crashed expansion's. */
const STALE_MS = 60 * 60 * 1000;

const count = z.number().int().nonnegative();
const relativePath = z
  .string()
  .min(1)
  .refine((p) => !isAbsolute(p) && !normalize(p).split(sep).includes('..'), 'a path inside the folder');
const place = z.tuple([z.string(), count]);
const segment = z.union([
  z.tuple([z.literal('raw'), count, count]),
  z.tuple([z.literal('copy'), z.string(), count, count]),
  z.tuple([
    z.literal('q4'),
    count,
    count,
    count.refine((b) => b > 0 && b % 2 === 0, 'an even block'),
    z.enum(['f32', 'f16']),
    place,
    place,
    place.nullable(),
  ]),
]);
const recipeSchema = z.object({
  version: z.literal(1),
  sources: z.record(z.string(), z.object({ path: relativePath, bytes: count })),
  raw: z.object({ path: relativePath, bytes: count }),
  files: z.array(
    z.object({
      path: relativePath,
      bytes: count,
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      segments: z.array(segment),
    }),
  ),
});
export type CoreMlRecipe = z.infer<typeof recipeSchema>;
type Segment = z.infer<typeof segment>;
type RecipeFile = CoreMlRecipe['files'][number];

/** What a first use wrote into `dir`, each file's sha256 checked against the recipe's, and how long it took. */
export interface WrittenCoreMlWeights {
  readonly dir: string;
  readonly ms: number;
  readonly files: readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[];
}

/** One log line for a write. */
export function describeWrittenWeights(written: WrittenCoreMlWeights): string {
  const bytes = written.files.reduce((sum, file) => sum + file.bytes, 0);
  const files = written.files.map((f) => `${f.path} sha256 ${f.sha256.slice(0, 12)} ok`).join(', ');
  return `Core ML weights written from the recipe into ${written.dir} in ${written.ms} ms (${(bytes / 1e6).toFixed(1)} MB): ${files}`;
}

/**
 * The folder the helper loads (`--models`) for a Core ML component, its weights written first when it has a recipe.
 * `onWritten` hears of a write (not of a folder already written, nor of a component without a recipe).
 */
export async function coreMlModelsDir(
  componentDir: string,
  onnxDir: string,
  onWritten?: (written: WrittenCoreMlWeights) => void,
): AsyncResult<string, string> {
  const read = await readFile(join(componentDir, COREML_RECIPE), 'utf8').then(
    (text) => ok(text),
    (cause: unknown) =>
      (cause as NodeJS.ErrnoException).code === 'ENOENT' ? ok(undefined) : err(String(cause)),
  );
  if (!read.ok) return err(`could not read ${COREML_RECIPE}: ${read.error}`);
  const text = read.value;
  if (text === undefined) return ok(componentDir);
  const parsed = parseRecipe(text);
  if (!parsed.ok) return parsed;
  const recipe = parsed.value;
  const digest = createHash('sha256').update(text).digest('hex');
  const target = join(componentDir, COREML_EXPANDED);
  if (await complete(target, recipe, digest)) return ok(target);
  await sweep(componentDir);
  const room = await roomFor(componentDir, recipe);
  if (room) return err(room);
  const temporary = join(
    componentDir,
    `${COREML_EXPANDED}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`,
  );
  const started = performance.now();
  try {
    const written = await expandInto(temporary, componentDir, onnxDir, recipe);
    if (!written.ok) return written;
    // What is on the disk, not what was handed to write(): checked before anything is moved into place (H2).
    const onDisk = await readBack(temporary, recipe.files);
    if (!onDisk.ok) return onDisk;
    await writeFile(join(temporary, MARKER), digest);
    const settled = await settle(temporary, target, recipe, digest);
    if (settled.ok) {
      const files = recipe.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
      onWritten?.({ dir: settled.value, ms: Math.round(performance.now() - started), files });
    }
    return settled;
  } catch (cause) {
    return err(
      `could not write the Core ML weights: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** The recipe, checked: its shape, and every source a segment reads listed. */
export function parseRecipe(text: string): Result<CoreMlRecipe, string> {
  const parsed = recipeSchema.safeParse(jsonFromText(text));
  if (!parsed.success)
    return err(`${COREML_RECIPE} is not a weight recipe (${parsed.error.issues[0]?.message})`);
  const listed = new Set(Object.keys(parsed.data.sources));
  for (const file of parsed.data.files) {
    const unknown = file.segments.flatMap(sourcesOf).find((name) => !listed.has(name));
    if (unknown !== undefined)
      return err(`${file.path} reads ${unknown}, which ${COREML_RECIPE} doesn't list`);
  }
  return ok(parsed.data);
}

/** The ONNX data files a segment reads. */
function sourcesOf(part: Segment): string[] {
  if (part[0] === 'copy') return [part[1]];
  if (part[0] === 'q4') return [part[5][0], part[6][0], ...(part[7] ? [part[7][0]] : [])];
  return [];
}

/** Renames a finished expansion into place, unless another process's is there already. */
async function settle(
  temporary: string,
  target: string,
  recipe: CoreMlRecipe,
  digest: string,
): AsyncResult<string, string> {
  if (await complete(target, recipe, digest)) return ok(target);
  // Something incomplete or damaged is in the way: moved aside first, so nothing ever loads half of it.
  const aside = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  if (existsSync(target)) await rename(target, aside).catch(() => undefined);
  await rm(aside, { recursive: true, force: true });
  try {
    await rename(temporary, target);
  } catch (cause) {
    if (await complete(target, recipe, digest)) return ok(target);
    return err(`could not move the written weights into place: ${String(cause)}`);
  }
  return ok(target);
}

/** Whether `dir` holds this recipe's expansion: its marker, and every written file at its size. */
async function complete(dir: string, recipe: CoreMlRecipe, digest: string): Promise<boolean> {
  const marker = await readFile(join(dir, MARKER), 'utf8').catch(() => '');
  if (marker !== digest) return false;
  for (const file of recipe.files) {
    const size = await stat(join(dir, file.path)).then(
      (s) => s.size,
      () => -1,
    );
    if (size !== file.bytes) return false;
  }
  return true;
}

/** Removes temporary folders a crashed expansion left. */
async function sweep(componentDir: string): Promise<void> {
  const names = await readdir(componentDir).catch(() => [] as string[]);
  for (const name of names) {
    if (!name.startsWith(`${COREML_EXPANDED}.`) || !name.endsWith('.tmp')) continue;
    const path = join(componentDir, name);
    const age = await stat(path).then(
      (s) => Date.now() - s.mtimeMs,
      () => 0,
    );
    if (age > STALE_MS) await rm(path, { recursive: true, force: true });
  }
}

/** Why the volume can't take the expansion, or undefined. */
async function roomFor(componentDir: string, recipe: CoreMlRecipe): Promise<string | undefined> {
  const need = recipe.files.reduce((sum, file) => sum + file.bytes, 0);
  // Free space that can't be read is no room: the caller stays on ONNX Runtime (IX3-F5, M1).
  const volume = await statfs(componentDir).then(
    (value) => ok(value),
    (cause: unknown) => err(String(cause)),
  );
  if (!volume.ok) return `could not read the free space on ${componentDir}: ${volume.error}`;
  const free = volume.value.bavail * volume.value.bsize;
  return free < need * 1.1
    ? `${(need / 1e9).toFixed(2)} GB needed to write the Core ML weights, ${(free / 1e9).toFixed(2)} GB free`
    : undefined;
}

interface Inputs {
  readonly raw: FileHandle;
  readonly sources: ReadonlyMap<string, FileHandle>;
}

/** Copies the component's own files and writes every file of the recipe into `dir`. */
async function expandInto(
  dir: string,
  componentDir: string,
  onnxDir: string,
  recipe: CoreMlRecipe,
): AsyncResult<void, string> {
  await copyTree(componentDir, dir, new Set([COREML_RECIPE, recipe.raw.path]));
  const opened = await openInputs(componentDir, onnxDir, recipe);
  if (!opened.ok) return opened;
  try {
    for (const file of recipe.files) {
      const written = await writeRecipeFile(join(dir, file.path), file, opened.value);
      if (!written.ok) return written;
    }
    return ok(undefined);
  } finally {
    await Promise.all([opened.value.raw, ...opened.value.sources.values()].map((h) => h.close()));
  }
}

async function copyTree(from: string, to: string, skip: ReadonlySet<string>): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (
      skip.has(entry.name) ||
      entry.name === COREML_EXPANDED ||
      entry.name.startsWith(`${COREML_EXPANDED}.`)
    )
      continue;
    const source = join(from, entry.name);
    if (entry.isDirectory()) await copyTree(source, join(to, entry.name), new Set());
    // A clone on APFS: no bytes copied.
    else if (entry.isFile()) await copyFile(source, join(to, entry.name), constants.COPYFILE_FICLONE);
  }
}

/** weights.raw and every ONNX data file the recipe reads, each checked against its recorded size. */
async function openInputs(
  componentDir: string,
  onnxDir: string,
  recipe: CoreMlRecipe,
): AsyncResult<Inputs, string> {
  const handles: FileHandle[] = [];
  const openSized = async (path: string, bytes: number): AsyncResult<FileHandle, string> => {
    const handle = await open(path, 'r').catch(() => undefined);
    if (!handle) return err(`${path} is missing`);
    handles.push(handle);
    const size = (await handle.stat()).size;
    return size === bytes ? ok(handle) : err(`${path} is ${size} bytes, the recipe was made from ${bytes}`);
  };
  const raw = await openSized(join(componentDir, recipe.raw.path), recipe.raw.bytes);
  const sources = new Map<string, FileHandle>();
  let failed = raw.ok ? undefined : raw.error;
  for (const [name, source] of Object.entries(recipe.sources)) {
    if (failed) break;
    const handle = await openSized(join(onnxDir, source.path), source.bytes);
    if (handle.ok) sources.set(name, handle.value);
    else failed = handle.error;
  }
  if (failed || !raw.ok) {
    await Promise.all(handles.map((h) => h.close()));
    return err(failed ?? 'weights.raw is missing');
  }
  return ok({ raw: raw.value, sources });
}

async function writeRecipeFile(path: string, file: RecipeFile, inputs: Inputs): AsyncResult<void, string> {
  await mkdir(dirname(path), { recursive: true });
  const out = await open(path, 'w');
  const hash = createHash('sha256');
  let written = 0;
  try {
    for (const part of file.segments) {
      for await (const bytes of segmentBytes(part, inputs)) {
        hash.update(bytes);
        await writeAll(out, bytes);
        written += bytes.length;
      }
    }
    await out.sync();
  } finally {
    await out.close();
  }
  const sha = hash.digest('hex');
  if (written === file.bytes && sha === file.sha256) return ok(undefined);
  return err(
    `${file.path}: wrote ${written} bytes, sha256 ${sha.slice(0, 12)}; the recipe says ${file.bytes}, ${file.sha256.slice(0, 12)}`,
  );
}

/** `length` bytes at `offset`; a source the recipe doesn't list (parseRecipe refuses those) is a bug. */
async function readAt(handle: FileHandle | undefined, offset: number, length: number): Promise<Uint8Array> {
  if (!handle) throw new Error('the recipe reads a file it does not list');
  const bytes = new Uint8Array(length);
  const { bytesRead } = await handle.read(bytes, 0, length, offset);
  if (bytesRead !== length) throw new Error(`read ${bytesRead} of ${length} bytes at ${offset}`);
  return bytes;
}

async function* chunks(
  handle: FileHandle | undefined,
  offset: number,
  length: number,
): AsyncGenerator<Uint8Array> {
  for (let done = 0; done < length; done += CHUNK) {
    yield await readAt(handle, offset + done, Math.min(CHUNK, length - done));
  }
}

async function* segmentBytes(part: Segment, inputs: Inputs): AsyncGenerator<Uint8Array> {
  if (part[0] === 'raw') {
    yield* chunks(inputs.raw, part[1], part[2]);
    return;
  }
  if (part[0] === 'copy') {
    yield* chunks(inputs.sources.get(part[1]), part[2], part[3]);
    return;
  }
  const [, rows, columns, block, scaleType, codesAt, scalesAt, zerosAt] = part;
  const blocks = columns / block;
  const codes = await readAt(inputs.sources.get(codesAt[0]), codesAt[1], (rows * columns) / 2);
  const scaleBytes = await readAt(
    inputs.sources.get(scalesAt[0]),
    scalesAt[1],
    rows * blocks * (scaleType === 'f32' ? 4 : 2),
  );
  const zeros = zerosAt
    ? await readAt(inputs.sources.get(zerosAt[0]), zerosAt[1], rows * Math.ceil(blocks / 2))
    : null;
  const half = dequantiseQ4({ rows, columns, block, codes, scales: scalesOf(scaleBytes, scaleType), zeros });
  yield new Uint8Array(half.buffer, half.byteOffset, half.byteLength);
}
