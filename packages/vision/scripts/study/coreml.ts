// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The mac helper's Core ML model for the studies and benches (`--coreml <embeddinggemma-2-coreml dir>`, IX2-E5),
 * over the development helper, with the ONNX folder's tokenizer.
 */
import { developmentCoreMlLoader, type CoreMlFolders } from '../../src/embed/coreml-development';
import type { EmbeddingModel } from '../../src/embed/model';

export async function coreMlLoader(folders: CoreMlFolders): Promise<() => Promise<EmbeddingModel>> {
  const loader = await developmentCoreMlLoader();
  if (!loader.ok)
    throw new Error(`--coreml needs the mac helper (${loader.error.code}): run native/mac-helper/build.sh`);
  return () => loader.value(folders);
}
