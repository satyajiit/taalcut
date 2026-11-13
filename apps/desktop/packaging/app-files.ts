// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What goes into app.asar: the bundles in out/ and package.json, plus the
 * production dependencies electron-builder collects (sqlite-vec, render's
 * HyperFrames producer, harfbuzzjs and gsap, and the on-device ML runtime's
 * JavaScript: transformers.js and onnxruntime-node).
 *
 * gsap ships whole, as published, with its licence headers: compositions load
 * its dist builds, which the render process copies into each bundle (render
 * SPEC G.1).
 *
 * The ML packages ship without native code or browser builds:
 * - onnxruntime-node's bin/ (every platform's binding, ~290 MB) stays out: the
 *   binding loads from the Developer ID-signed `onnxruntime` component
 *   (src/utility/component-natives.ts).
 * - onnxruntime-web (~140 MB) stays out: transformers.node.mjs inlines the
 *   part it needs and runs on onnxruntime-node in Node.
 * - transformers.js keeps only its Node ESM build (vision imports it with
 *   `import()`), not the browser, CommonJS and minified copies or types.
 *
 * Crash reports' SDK ships inside main's bundle only: tsdown inlines @sentry/*
 * and the @opentelemetry/api it loads (tsdown.config.ts), so their copies in
 * node_modules (~57 MB) stay out. @sentry/electron remains a production
 * dependency for the licence scan and the NOTICE. A runtime import of either
 * scope would find nothing: the build refuses one in a bundle
 * (bundle-imports.ts), and test/inlined-sdk.test.ts one from a shipped package.
 */

/** Scopes main's bundle inlines and app.asar leaves out. */
export const INLINED_SCOPES = ['@sentry', '@opentelemetry'] as const;

export const APP_FILES: readonly string[] = [
  'out/**/*',
  '!out/**/*.map',
  'package.json',
  '!**/node_modules/onnxruntime-node/bin/**',
  '!**/node_modules/onnxruntime-node/script/**',
  '!**/node_modules/onnxruntime-node/lib/**',
  '!**/node_modules/onnxruntime-web/**',
  '!**/node_modules/@huggingface/transformers/types/**',
  '!**/node_modules/@huggingface/transformers/src/**',
  '!**/node_modules/@huggingface/transformers/dist/*.{cjs,js,map}',
  '!**/node_modules/@huggingface/transformers/dist/*.min.mjs',
  '!**/node_modules/@huggingface/transformers/dist/ort-wasm-*',
  ...INLINED_SCOPES.map((scope) => `!**/node_modules/${scope}/**`),
];
