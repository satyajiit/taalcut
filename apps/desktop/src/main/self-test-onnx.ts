// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `--taalcut-self-test=onnx` (test builds only; test-hooks.ts): the on-device
 * ML runtime as the packaged jobs process loads it. ONNX Runtime's binding
 * from the installed `onnxruntime` component through the same resolve hook
 * (src/utility/component-natives.ts), transformers.js from the app's
 * node_modules, EmbeddingGemma 2 from its component, one query embedded on
 * the GPU when it can be. Prints which binding file was loaded, the device
 * and the vector's size and length, so the packaged e2e can check that
 * nothing came from node_modules and that the signed library loaded under the
 * hardened runtime.
 */
import { join } from 'node:path';
import { installedComponentDirSync } from '@taalcut/jobs';
import { createEmbedder, EMBEDDING_COMPONENT } from '@taalcut/vision';
import { disableOrtTelemetry } from '../shared/ort-telemetry';
import { installComponentNatives, ONNXRUNTIME_COMPONENT } from '../utility/component-natives';

export async function onnxSelfTest(userData: string, packaged: boolean): Promise<Record<string, unknown>> {
  const componentsRoot = join(userData, 'components');
  disableOrtTelemetry();
  installComponentNatives({ componentsRoot, packaged, log: () => undefined });
  const modelDir = installedComponentDirSync(componentsRoot, EMBEDDING_COMPONENT) ?? null;
  const fallbacks: string[] = [];
  const embedder = createEmbedder({
    modelDir: async () => modelDir,
    onFallback: (event) => fallbacks.push(`${event.operation}: ${event.reason}`),
  });
  try {
    const vectors = await embedder.embedTexts(['a beach at sunset'], { purpose: 'query' });
    if (!vectors.ok) return { error: vectors.error.code, detail: vectors.error.detail ?? '' };
    const [vector] = vectors.value;
    const norm = Math.sqrt((vector ?? new Float32Array()).reduce((sum, x) => sum + x * x, 0));
    // The report's typings don't list sharedObjects: on macOS it is every loaded library's path.
    const report = process.report.getReport() as unknown as { sharedObjects?: string[] };
    return {
      onnxruntime: installedComponentDirSync(componentsRoot, ONNXRUNTIME_COMPONENT) ?? null,
      loaded: (report.sharedObjects ?? []).filter((path) => /onnxruntime/.test(path)),
      device: embedder.device(),
      dimensions: vector?.length ?? 0,
      norm,
      fallbacks,
    };
  } finally {
    await embedder.close();
  }
}
