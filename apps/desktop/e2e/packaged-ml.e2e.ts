// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The on-device ML runtime in the packaged test build (release/test): the
 * app ships transformers.js and onnxruntime-node's JavaScript but no ONNX
 * Runtime binary; the binding and libonnxruntime come from the `onnxruntime`
 * component, signed with the app's Developer ID, so the hardened runtime
 * (library validation on) loads them. EmbeddingGemma 2 comes from its
 * component and embeds a query on the GPU.
 *
 * The components are installed into the test's user data by the component
 * manager from cached archives and licence notices (seed-components.ts), without network access.
 * Without those files the runtime test skips and says which are missing.
 * Library validation only holds with a Developer ID build
 * (TAALCUT_MAC_IDENTITY); an ad-hoc build disables it, which the test notes.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { openAsar } from './asar';
import { assertPackaged, PACKAGED_UNAVAILABLE, RELEASE_APP, startPackaged, TEST_APP } from './packaged-app';
import { missingArchives, seedComponents } from './seed-components';

const NEEDED = ['onnxruntime', 'embeddinggemma-2'];

test.skip(Boolean(PACKAGED_UNAVAILABLE), PACKAGED_UNAVAILABLE);
test.beforeAll(() => assertPackaged(TEST_APP, RELEASE_APP));

test('ships transformers.js and onnxruntime-node without native ONNX Runtime or the browser runtime', () => {
  const files = [...openAsar(join(RELEASE_APP, 'Contents', 'Resources', 'app.asar')).files.keys()];
  expect(files).toContain('node_modules/@huggingface/transformers/dist/transformers.node.mjs');
  expect(files).toContain('node_modules/onnxruntime-node/dist/binding.js');
  expect(files).toContain('node_modules/onnxruntime-common/package.json');
  expect(files.filter((file) => /onnxruntime.*\.(node|dylib)$/.test(file))).toEqual([]);
  expect(files.filter((file) => file.startsWith('node_modules/onnxruntime-web/'))).toEqual([]);
  // transformers.js: its Node ESM build only.
  expect(files.filter((file) => file.startsWith('node_modules/@huggingface/transformers/dist/'))).toEqual([
    'node_modules/@huggingface/transformers/dist/transformers.node.mjs',
  ]);
  // Render's production dependencies, external to its bundle, are there too.
  expect(files).toContain('node_modules/harfbuzzjs/package.json');
  expect(files).toContain('node_modules/@hyperframes/producer/package.json');
  // GSAP's browser builds, which compositions load from the render's own serving (render SPEC G.2).
  expect(files).toContain('node_modules/gsap/package.json');
  expect(files).toContain('node_modules/gsap/dist/gsap.min.js');
});

test('ONNX Runtime loads from the signed component and EmbeddingGemma 2 embeds on the GPU', async () => {
  const missing = missingArchives(NEEDED);
  test.skip(missing.length > 0, `component archives not built here: ${missing.join(', ')}`);
  // codesign -dv reports on stderr.
  const details = spawnSync('codesign', ['-dv', TEST_APP], { encoding: 'utf8' }).stderr;
  const team = /TeamIdentifier=(\w+)/.exec(details)?.[1];
  test.info().annotations.push({
    type: 'signing',
    description:
      team && team !== 'not'
        ? `Developer ID team ${team}: library validation on`
        : "ad-hoc build: library validation off, so this doesn't prove the component's signature",
  });
  const userData = mkdtempSync(join(tmpdir(), 'taalcut-packaged-ml-'));
  await seedComponents(userData, NEEDED);
  const app = startPackaged(TEST_APP, { userData, args: ['--taalcut-self-test=onnx'] });
  try {
    expect(await app.exitWithin(120_000), app.stderr()).toBe(0);
    const line = app
      .stdout()
      .split('\n')
      .find((l) => l.startsWith('TAALCUT_SELF_TEST '));
    const result = JSON.parse(line?.slice('TAALCUT_SELF_TEST '.length) ?? '{}') as {
      onnxruntime?: string;
      loaded?: string[];
      device?: string;
      dimensions?: number;
      norm?: number;
      fallbacks?: string[];
    };
    expect(result.onnxruntime).toContain(join(userData, 'components', 'installed', 'onnxruntime'));
    // Both native files from the component, none from the app.
    expect(result.loaded).toHaveLength(2);
    for (const path of result.loaded ?? []) expect(path.startsWith(result.onnxruntime!)).toBe(true);
    expect(result.dimensions).toBe(768);
    expect(result.norm).toBeCloseTo(1, 5);
    // ADR 0002: WebGPU on this Mac; a CPU fallback must say why.
    expect(result.device).toBe('webgpu');
    expect(result.fallbacks).toEqual([]);
  } finally {
    await app.stop();
  }
});
