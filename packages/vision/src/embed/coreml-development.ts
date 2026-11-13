// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Core ML model over the development mac helper (native/mac-helper/build.sh, or TAALCUT_MAC_HELPER), for the
 * studies, the benches, the search eval and the parity test (IX2-E5). The app resolves its own pinned helper and
 * manages its process (apps/desktop vision-coreml.ts). Frames are written to `tempDir`, which must be a resolved
 * path: the helper resolves symlinks before it checks its allowed root. A component packed with a recipe instead of
 * its weights (IX3-N3) has them written from `tokenizerDir`'s ONNX component first (`coreMlModelsDir`).
 */
import { ok, type AsyncResult } from '@taalcut/core';
import { createJsonLineSidecar, createSidecarResolver } from '@taalcut/media';
import { embedServeArgs, loadCoreMlModel } from './coreml-model';
import { coreMlModelsDir } from './coreml-weights';
import type { EmbeddingModel } from './model';

export interface CoreMlFolders {
  /** An unpacked `embeddinggemma-2-coreml` component. */
  readonly coremlDir: string;
  /** The ONNX component's folder, for its tokenizer. */
  readonly tokenizerDir: string;
  /** Where frames are written for the helper, a resolved path. */
  readonly tempDir: string;
}

/** A loader of the Core ML model over the development helper, or why there is no helper. */
export async function developmentCoreMlLoader(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AsyncResult<(folders: CoreMlFolders) => Promise<EmbeddingModel>> {
  const helper = await createSidecarResolver({
    name: 'taalcut-mac-helper',
    development: true,
    pin: '',
    env,
  }).resolve();
  if (!helper.ok) return helper;
  const command = helper.value.path;
  return ok(async ({ coremlDir, tokenizerDir, tempDir }: CoreMlFolders) => {
    const models = await coreMlModelsDir(coremlDir, tokenizerDir);
    if (!models.ok) throw new Error(`the Core ML weights could not be written: ${models.error}`);
    return loadCoreMlModel({
      open: () => createJsonLineSidecar({ command, args: embedServeArgs(models.value, [tempDir]) }),
      tempDir,
      tokenizerDir,
    });
  });
}
