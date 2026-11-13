// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs utility process (out/utility/jobs.mjs).
 *
 * Test-only code sits behind `__TAALCUT_FLAVOUR__ === 'test'` and is loaded
 * with import(), so release bundles don't contain it.
 */
import { join } from 'node:path';
import { installComponentNatives } from './component-natives';
import { refusesDevelopmentKey } from './roots/components';
import { managedNativesOnly } from './roots/dev-components';
import { composeJobs, type JobsRootOptions } from './roots/jobs-root';
import { exitOnTerminate, runUtility } from './runtime';
import { shotModelPorts } from './shot-model-port';

/** Test builds: the embedding model's stand-in when asked for (offline e2e runs have no model component). */
async function testOptions(): Promise<Partial<JobsRootOptions>> {
  const { STANDIN_EMBEDDINGS_ENV, standInEmbeddingLoader } = await import('../shared/standin-embeddings');
  return process.env[STANDIN_EMBEDDINGS_ENV] === '1'
    ? { vision: { embeddingLoader: standInEmbeddingLoader } }
    : {};
}

exitOnTerminate(
  runUtility(
    'jobs',
    async (config, main) => {
      // ONNX Runtime's native binding from the onnxruntime component, before anything can load it.
      installComponentNatives({
        componentsRoot: join(config.userData, 'components'),
        packaged: config.packaged,
        managedOnly: managedNativesOnly(config.packaged),
      });
      const test = __TAALCUT_FLAVOUR__ === 'test' ? await testOptions() : {};
      return composeJobs(config, {
        // A packaged release build; `pnpm dev` (release flavour, unpackaged) is a development build.
        release: refusesDevelopmentKey({ flavour: __TAALCUT_FLAVOUR__, packaged: config.packaged }),
        ...(main ? { main } : {}),
        ...test,
        // TransNetV2 runs in a process of its own, which main forks when asked (IX2-S2). The OCR helper compiles
        // Vision's models from the start, before the Core ML embedder's first compile (FIX-OCRCOLD).
        vision: { ...test.vision, shotModel: shotModelPorts(process.parentPort), warmOcrAtStart: true },
      });
    },
    process.parentPort,
  ),
);
