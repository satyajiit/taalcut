// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Architecture rules from PRD section 6.2, enforced in CI (P1-A2).
 *
 * - Every package has one public entry point (src/index.ts), plus an optional
 *   Node-only entry (src/node.ts) for process adapters the renderer must never
 *   bundle, and an optional test-support entry (src/test-support.ts) that only
 *   tests and e2e tests may import. Core also has `@taalcut/core/hub`
 *   (src/hub/index.ts), the side-effect-free entry the hub Worker bundles.
 *   Importing any other path inside another package fails.
 * - No cycles.
 * - Packages may depend only on the packages listed in ALLOWED below.
 * - Only apps/desktop may import Electron. The renderer and the UI kit may not
 *   import Node built-ins.
 */

/** Which workspace packages each package may import (PRD 6.2). */
const ALLOWED = {
  core: [],
  agent: ['core', 'models', 'tools'],
  tools: ['core'],
  shorts: ['core'],
  models: ['core'],
  media: ['core'],
  vision: ['core', 'media', 'models'],
  audio: ['core', 'media'],
  library: ['core'],
  jobs: ['core'],
  templates: ['core', 'vision', 'audio'],
  timeline: ['core', 'library', 'templates'],
  render: ['core', 'media', 'timeline'],
  transfer: ['core', 'media'],
  ui: ['core'],
};

const layering = Object.entries(ALLOWED).map(([pkg, allowed]) => ({
  name: `layering-${pkg}`,
  severity: 'error',
  comment:
    allowed.length === 0
      ? `packages/${pkg} must not import any other Taalcut package (PRD 6.2).`
      : `packages/${pkg} may only import: ${allowed.join(', ')} (PRD 6.2).`,
  from: { path: `^packages/${pkg}/` },
  to: { path: '^(packages|apps)/', pathNot: `^packages/(${[pkg, ...allowed].join('|')})/` },
}));

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular imports are not allowed. Move the shared piece down a layer, usually into packages/core.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'public-api-only',
      severity: 'error',
      comment:
        "Import another package only through its public entry point (e.g. '@taalcut/core'), its Node-only entry ('@taalcut/models/node') or core's hub entry ('@taalcut/core/hub'), never another file inside its src/.",
      from: { path: '^(packages|apps|tools)/([^/]+)/' },
      to: {
        path: '^packages/([^/]+)/',
        pathNot: [
          '^packages/$2/',
          '^packages/[^/]+/src/index\\.tsx?$',
          '^packages/[^/]+/src/node\\.ts$',
          '^packages/[^/]+/src/test-support\\.ts$',
          '^packages/core/src/hub/index\\.ts$',
        ],
      },
    },
    {
      name: 'test-support-only-in-tests',
      severity: 'error',
      comment:
        "A package's test-support entry (mock servers and the like) is for tests and e2e tests only, never app or package code.",
      from: { pathNot: '(^|/)(test|e2e)/|\\.(test|spec)\\.tsx?$|^packages/[^/]+/src/test-support' },
      to: { path: '^packages/[^/]+/src/test-support' },
    },
    ...layering,
    {
      name: 'ui-imports-core-types-only',
      severity: 'error',
      comment:
        'packages/ui may import types from core, but no runtime code (PRD 6.2: ui depends on nothing outside UI libraries).',
      from: { path: '^packages/ui/' },
      to: { path: '^packages/core/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'renderer-allowed-packages',
      severity: 'error',
      comment:
        'apps/renderer may only import @taalcut/ui and @taalcut/core. Everything else is reached over IPC.',
      from: { path: '^apps/renderer/' },
      to: { path: '^(packages|apps)/', pathNot: '^(apps/renderer|packages/(core|ui))/' },
    },
    {
      name: 'sandboxed-code-has-no-node',
      severity: 'error',
      comment:
        'The renderer, the UI kit and the Workers have no Node built-ins. A Worker uses WebCrypto and fetch.',
      from: {
        path: '^(apps/renderer|packages/ui|services/(hub|billing)-worker/src)/',
        pathNot: '\\.(test|spec)\\.tsx?$|/(test|e2e)/|\\.config\\.ts$',
      },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'layering-services',
      severity: 'error',
      comment: 'services/ may import @taalcut/core and nothing else from packages/ or apps/.',
      from: { path: '^services/' },
      to: { path: '^(packages|apps)/', pathNot: '^packages/core/' },
    },
    {
      name: 'hub-standalone',
      severity: 'error',
      comment: 'hub/ imports no workspace package. It must run alone once copied out of this repo.',
      from: { path: '^hub/' },
      to: { path: '^(packages|apps|services)/' },
    },
    {
      name: 'services-not-imported',
      severity: 'error',
      comment: 'packages/, apps/ and tools/ do not import services/.',
      from: { path: '^(packages|apps|tools)/' },
      to: { path: '^services/' },
    },
    {
      name: 'electron-only-in-desktop',
      severity: 'error',
      comment:
        'Only apps/desktop may import Electron. Packages stay framework-free so they can run in utility processes and tests.',
      from: { pathNot: '^apps/desktop/' },
      to: { path: 'node_modules/electron/' },
    },
    {
      name: 'packages-never-import-apps',
      severity: 'error',
      comment: 'Packages must not import from apps/. Apps compose packages, not the other way round.',
      from: { path: '^(packages|tools)/' },
      to: { path: '^apps/' },
    },
    {
      name: 'desktop-not-renderer',
      severity: 'error',
      comment: 'apps/desktop must not import renderer or UI code.',
      from: { path: '^apps/desktop/' },
      to: { path: '^(apps/renderer|packages/ui)/' },
    },
    {
      name: 'website-stands-alone',
      severity: 'error',
      comment:
        'The website imports no Taalcut package or app code (docs/release.md, "The website"); it reads only design/ and docs/.',
      from: { path: '^website/' },
      to: { path: '^(apps|packages|tools)/' },
    },
    {
      name: 'nothing-imports-website',
      severity: 'error',
      comment: 'The website is a separate static site; the app and its packages never import from it.',
      from: { path: '^(apps|packages|tools)/' },
      to: { path: '^website/' },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment:
        'This import cannot be resolved. Add the dependency to the package.json of the importing package. cloudflare: is the Workers vitest runtime, not a package.',
      from: {},
      to: { couldNotResolve: true, pathNot: '^cloudflare:' },
    },
  ],
  options: {
    doNotFollow: { path: '(^|/)node_modules/' },
    exclude: {
      path: '(^|/)(node_modules|dist|out|coverage|\\.turbo|\\.claude|\\.spikes|e2e-artifacts|test-results)/|^apps/desktop/release/|^fixtures/lint-violations/|^tools/ffmpeg/|^tools/whisper/\\.build/|^tools/components/\\.cache/|^packages/vision/\\.cache/|^website/\\.next/|^website/public/brand/|\\.gen\\.ts$',
    },
    tsPreCompilationDeps: true,
    preserveSymlinks: false,
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['types', 'import', 'require', 'node', 'default'],
      mainFields: ['types', 'module', 'main'],
      extensions: ['.ts', '.tsx', '.d.ts', '.js', '.mjs', '.cjs', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
