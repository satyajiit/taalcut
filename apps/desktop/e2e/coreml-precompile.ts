// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing bench's stand-in for the compile a Mac does once after it installs the Core ML embedder (IX2-E5): the
 * helper's `embed.prepare` on the seeded component, so the timed import measures the compiled model, as every import
 * after the first does. Core ML keeps the compile per model path, so it must run on the seeded folder itself. The
 * plain e2e skips it and runs a first import's path instead: ONNX Runtime until the compile finishes, then Core ML.
 * A component that carries a weight recipe (IX3-N3) has its weights written first, as the jobs process would, and the
 * write is logged (folder, time, each file's sha256 check).
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { coreMlModelsDir, describeWrittenWeights, developmentCoreMlLoader } from '@taalcut/vision';

/** Compiles the Core ML embedder at `coremlDir` for this Mac. Returns how long it took. */
export async function precompileCoreMl(
  coremlDir: string,
  tokenizerDir: string,
  scratch: string,
): Promise<number> {
  const started = Date.now();
  const models = await coreMlModelsDir(coremlDir, tokenizerDir, (written) =>
    console.warn(`[seed] ${describeWrittenWeights(written)}`),
  );
  if (!models.ok) throw new Error(`the Core ML embedder's weights could not be written: ${models.error}`);
  if (models.value === coremlDir)
    console.warn('[seed] Core ML embedder packed with its weights: no recipe to write');
  const loader = await developmentCoreMlLoader();
  if (!loader.ok) throw new Error(`no mac helper to compile the Core ML embedder: ${loader.error.code}`);
  const tempDir = join(scratch, 'coreml-precompile');
  await mkdir(tempDir, { recursive: true });
  try {
    const model = await loader.value({ coremlDir, tokenizerDir, tempDir });
    await model.dispose();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
  return Date.now() - started;
}
