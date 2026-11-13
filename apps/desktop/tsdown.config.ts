// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Bundles the three kinds of Electron entry. Everything except 'electron' is
 * bundled in, so the packaged app needs no node_modules.
 *
 * - main:    ESM for Node (out/main/index.mjs).
 * - preload: one CommonJS file (out/preload/index.cjs). A sandboxed preload
 *            can't load ESM and can require only 'electron' (plus a few
 *            polyfilled modules), so it is built for the browser. It takes
 *            two constants from @taalcut/core (side-effect free, so nothing
 *            else comes along) and bundles no third-party code; onlyBundle
 *            and onlyImport make the build fail if anything sneaks in.
 * - utility: ESM entries for utilityProcess.fork (out/utility/*.mjs).
 * - placeholder: the placeholder renderer's script (out/placeholder/probe.mjs).
 *
 * sqlite-vec stays external: it finds its native .dylib through
 * import.meta.resolve, and the .dylib must be unpacked from the ASAR.
 *
 * Build settings (flavour, update feed) come from the environment and are
 * baked in as constants (packaging/build-settings.ts), then written to
 * out/build-info.json for the packaging step. So is the pin of the mac helper
 * in native/mac-helper/dist, if one is built (packaging/mac-helper.ts).
 */
import { defineConfig, type UserConfig } from 'tsdown';
import {
  buildSettingsFromEnv,
  bundleDefines,
  writeBuildInfo,
  type BuildSettings,
} from './packaging/build-settings';
import { assertInlined } from './packaging/bundle-imports';
import { macHelperPin } from './packaging/mac-helper';

const pin = macHelperPin(import.meta.dirname);
const settings: BuildSettings = {
  ...buildSettingsFromEnv(process.env),
  ...(pin ? { macHelperPin: pin } : {}),
};

const shared: UserConfig = {
  target: 'node24',
  dts: false,
  hash: false,
  clean: true,
  fixedExtension: true,
  sourcemap: true,
  report: false,
  define: bundleDefines(settings),
};

function assertOnlyRequires(
  chunks: readonly { type: string; fileName: string; code?: string }[],
  allowed: string[],
) {
  for (const chunk of chunks) {
    if (chunk.type !== 'chunk' || !chunk.code) continue;
    for (const [, id] of chunk.code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
      if (!allowed.includes(id ?? '')) {
        throw new Error(
          `${chunk.fileName} requires '${id}', but a sandboxed preload can only require ${allowed.join(', ')}.`,
        );
      }
    }
  }
}

/** Workspace packages are TypeScript source and always bundled; third-party code only if listed. */
const bundleWorkspace = (onlyBundle: (string | RegExp)[] | false) => ({
  neverBundle: ['electron', /^sqlite-vec(-|$)/],
  // @sentry/electron is a production dependency, which tsdown would leave external.
  // The packaged app ships out/ and package.json only, so the SDK has to be inlined.
  alwaysBundle: [/^@taalcut\//, /^@sentry\//],
  onlyBundle,
});

/** Third-party code bundled into main (everything it runs except electron and sqlite-vec). */
const MAIN_BUNDLED = [
  // The composition root: oRPC and awilix (@taalcut/core), drizzle (@taalcut/library).
  /^@orpc\//,
  'awilix',
  // awilix's module loader (unused, but its container references it): fast-glob and its dependencies.
  'fast-glob',
  /^@nodelib\//,
  'braces',
  'fastq',
  'fill-range',
  'glob-parent',
  'is-extglob',
  'is-glob',
  'is-number',
  'merge2',
  'micromatch',
  'picomatch',
  'queue-microtask',
  'reusify',
  'run-parallel',
  'to-regex-range',
  'ulid',
  'zod',
  // Product publishing validates weighted post length with the existing twitter-text runtime.
  'twitter-text',
  '@babel/runtime',
  'core-js',
  'punycode',
  'twemoji-parser',
  // Outbound plugin MCP clients and their schema validator run beside main's credential vault.
  /^@modelcontextprotocol\//,
  'eventsource',
  'eventsource-parser',
  'jose',
  'pkce-challenge',
  'cross-spawn',
  'path-key',
  'shebang-command',
  'shebang-regex',
  'which',
  'isexe',
  'drizzle-orm',
  // Main's durable local/Photos import sink shares the existing BLAKE3 implementation.
  'hash-wasm',
  // Phone import errors use transfer's public entry, which also references its tus transport.
  '@tus/server',
  '@tus/file-store',
  '@tus/utils',
  'lodash.throttle',
  'electron-updater',
  'builder-util-runtime',
  'fs-extra',
  'graceful-fs',
  'jsonfile',
  'universalify',
  'js-yaml',
  'argparse',
  'lazy-val',
  'lodash.isequal',
  'lodash.escaperegexp',
  'semver',
  'tiny-typed-emitter',
  'sax',
  'debug',
  'ms',
  'supports-color',
  'has-flag',
  // Main's translations (src/main/i18n): Lingui's runtime and the message formatter it uses.
  '@lingui/core',
  '@lingui/message-utils',
  '@messageformat/parser',
  '@messageformat/date-skeleton',
  'moo',
  // Sign-in and key checks (@taalcut/models' AuthBroker): pi-ai and the provider SDKs it loads.
  /^@earendil-works\//,
  '@anthropic-ai/sdk',
  '@google/genai',
  'openai',
  'partial-json',
  'ws',
  'standardwebhooks',
  '@stablelib/base64',
  'fast-sha256',
  'p-retry',
  'retry',
  // google-auth-library (from @google/genai) and what it brings.
  'google-auth-library',
  'google-logging-utils',
  'gcp-metadata',
  'gaxios',
  'extend',
  'https-proxy-agent',
  'agent-base',
  'node-fetch',
  'fetch-blob',
  'formdata-polyfill',
  'data-uri-to-buffer',
  'node-domexception',
  'web-streams-polyfill',
  'json-bigint',
  'bignumber.js',
  'jws',
  'jwa',
  'ecdsa-sig-formatter',
  'buffer-equal-constant-time',
  'safe-buffer',
  'base64-js',
  // Crash reports (P2-X5): @sentry/electron/main and the packages that entry loads.
  /^@sentry\//,
  '@opentelemetry/api',
];

export default defineConfig([
  {
    ...shared,
    name: 'main',
    platform: 'node',
    entry: { index: 'src/main/index.ts' },
    outDir: 'out/main',
    format: 'esm',
    deps: bundleWorkspace(MAIN_BUNDLED),
    hooks: {
      'build:done': ({ chunks }) => {
        assertInlined(chunks);
        writeBuildInfo(import.meta.dirname, settings);
      },
    },
  },
  {
    ...shared,
    name: 'preload',
    platform: 'browser',
    entry: { index: 'src/preload/index.ts' },
    outDir: 'out/preload',
    format: 'cjs',
    deps: { ...bundleWorkspace([]), onlyImport: ['electron'] },
    // tsdown switches CJS builds to platform 'node' whatever the config says; switch it back.
    inputOptions: (options) => ({ ...options, platform: 'browser' }),
    // onlyImport doesn't see CommonJS require(), so check the output text as well.
    hooks: { 'build:done': ({ chunks }) => assertOnlyRequires(chunks, ['electron']) },
    suppressWarnings: 'ESM format instead of CommonJS',
  },
  {
    ...shared,
    name: 'utility',
    platform: 'node',
    entry: {
      agent: 'src/utility/agent.ts',
      jobs: 'src/utility/jobs.ts',
      render: 'src/utility/render.ts',
      lan: 'src/utility/lan.ts',
      mcp: 'src/utility/mcp.ts',
      // TransNetV2's own process (IX2-S2), forked by main for the jobs process.
      'shot-model': 'src/utility/shot-model.ts',
    },
    outDir: 'out/utility',
    format: 'esm',
    // Tokens and schemas initialize one another. Keep core in one chunk so the shared entry split cannot
    // place a token's createToken call before its factory's module initialization.
    outputOptions: {
      codeSplitting: { groups: [{ name: 'core', test: /[\\/]packages[\\/]core[\\/]src[\\/]/ }] },
    },
    // Render's engine reads files from its own packages (the HyperFrames runtime, harfbuzz's WASM, GSAP's
    // browser builds that a composition loads) and drives Chrome through puppeteer: those stay external, shipped
    // as the app's production dependencies.
    deps: {
      ...bundleWorkspace(false),
      neverBundle: [
        ...bundleWorkspace(false).neverBundle,
        /^@hyperframes\//,
        /^puppeteer/,
        'harfbuzzjs',
        /^gsap(\/|$)/,
      ],
    },
    // SOUL.md goes into agent.mjs as text.
    loader: { '.md': 'text' },
    hooks: { 'build:done': ({ chunks }) => assertInlined(chunks) },
  },
  {
    // The placeholder renderer's script, copied into out/renderer with it (scripts/copy-renderer.mjs).
    ...shared,
    name: 'placeholder',
    platform: 'browser',
    entry: { probe: 'src/placeholder/probe.ts' },
    outDir: 'out/placeholder',
    format: 'esm',
    deps: bundleWorkspace(false),
  },
]);
