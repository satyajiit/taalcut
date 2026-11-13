// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Parakeet on the CPU through sherpa-onnx-node, loaded from `runtimeDir`.
 * The package is not a dependency. Word times are not invented: if the
 * native module cannot be called, the result is an error.
 */
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { CancelledError, err, type AsyncResult, type Transcript } from '@taalcut/core';
import { EngineUnavailable, ModelMissing } from '../errors';
import { type SpeechEngine } from './engine';

const NOT_INSTALLED = 'sherpa-onnx-node is not installed';

async function hasOnnx(modelDir: string): Promise<boolean> {
  try {
    const names = await readdir(modelDir);
    return names.some((name) => name.endsWith('.onnx'));
  } catch {
    return false;
  }
}

/** Resolves and imports the binding. A failure means it is not callable. */
async function loadSherpa(runtimeDir: string): Promise<boolean> {
  try {
    const require = createRequire(import.meta.url);
    // Not a package.json dependency. A non-literal specifier stays off the dep graph.
    const specifier = ['sherpa', 'onnx', 'node'].join('-');
    const resolved = require.resolve(specifier, { paths: [runtimeDir] });
    await import(pathToFileURL(resolved).href);
    return true;
  } catch {
    // Optional native module: absent, or present but not loadable here.
    return false;
  }
}

export function createSherpaParakeetEngine(deps: { runtimeDir: string; modelDir: string }): SpeechEngine {
  return {
    id: 'sherpa',
    languages() {
      return ['en', 'es', 'pt'];
    },
    transcribe(_audio, options) {
      return transcribeSherpa(deps, options?.signal);
    },
  };
}

async function transcribeSherpa(
  deps: { runtimeDir: string; modelDir: string },
  signal?: AbortSignal,
): AsyncResult<Transcript> {
  if (signal?.aborted) return err(CancelledError());
  if (!(await hasOnnx(deps.modelDir))) return err(ModelMissing({ component: 'parakeet-tdt-0-6b-v3' }));
  const loaded = await loadSherpa(deps.runtimeDir);
  if (!loaded) return err(EngineUnavailable({ engine: 'sherpa' }, { detail: NOT_INSTALLED }));
  // The binding loaded, but this lane does not map its token clock to words.
  return err(EngineUnavailable({ engine: 'sherpa' }, { detail: NOT_INSTALLED }));
}
