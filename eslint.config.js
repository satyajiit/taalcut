// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Lint rules that enforce the architecture (P1-A2):
 * - no file over 400 lines (PRD R31);
 * - no provider SDK or pi-ai import outside packages/models (PRD R26);
 * - no import into another package's src/ (dependency-cruiser checks this too);
 * - no hard-coded user-facing string in the renderer or the UI kit (Lingui, decision D7).
 */
import js from '@eslint/js';
import lingui from 'eslint-plugin-lingui';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** pi-ai and every provider SDK. Only packages/models may import these. */
const MODEL_SDKS = [
  '@earendil-works/pi-ai',
  '@earendil-works/pi-ai/*',
  '@mariozechner/pi-ai',
  'openai',
  'openai/*',
  '@anthropic-ai/*',
  '@google/genai',
  '@google/generative-ai',
  '@aws-sdk/client-bedrock-runtime',
  '@mistralai/*',
  'groq-sdk',
  'cohere-ai',
  'ollama',
  'ai',
  '@ai-sdk/*',
  '@openrouter/*',
  'elevenlabs',
  '@elevenlabs/*',
];

const deepImport = {
  group: ['@taalcut/*/src', '@taalcut/*/src/*'],
  message: "Import a package through its public entry point (e.g. '@taalcut/core'), never a path inside it.",
};
const modelSdk = {
  group: MODEL_SDKS,
  message: 'Only packages/models may import pi-ai or a provider SDK (PRD R26). Call it through @taalcut/models.',
};

/** e2e tests start the app only through apps/desktop/e2e/launch.ts; a bare _electron.launch can hang. */
const ELECTRON_LAUNCH =
  "Launch the app with launchElectron from e2e/launch.ts: it holds 'ready' until Playwright attaches, without which electron.launch can hang.";
const electronLaunch = ['@playwright/test', 'playwright', 'playwright-core'].map((name) => ({
  name,
  importNames: ['_electron'],
  message: ELECTRON_LAUNCH,
}));

/** Strings that are not user-facing: identifiers, keys, CSS classes, constants, punctuation, SVG path data. */
const linguiOptions = {
  ignore: ['^(?![A-Z])\\S+$', '^[A-Z0-9_-]+$', '^[^A-Za-z]*$', '^M-?\\d[\\d\\s.,ACHLMQSTVZachlmqstvz-]*$'],
  ignoreNames: [
    { regex: { pattern: 'className', flags: 'i' } },
    { regex: { pattern: '^[A-Z0-9_-]+$' } },
    { regex: { pattern: '^(data|aria-hidden)' } },
    'styleName', 'src', 'srcSet', 'type', 'id', 'key', 'href', 'to', 'from', 'rel', 'target', 'role',
    'variant', 'size', 'side', 'align', 'name', 'as', 'method', 'mode', 'path', 'icon', 'lang', 'dir',
    'autoComplete', 'inputMode', 'kind', 'channel', 'event', 'testId', 'displayName', 'width', 'height',
  ],
  ignoreFunctions: [
    'cva', 'cn', 'clsx', 'twMerge', 'Error', 'TypeError', 'RangeError', 'console.*', 'invariant',
    'createFileRoute', 'createRoute', 'createRootRoute', 'createLazyFileRoute', 'Symbol', 'z.*', 'URL',
    '*.matchMedia', 'matchMedia', '*.addEventListener', '*.removeEventListener', '*.setAttribute',
    '*.getAttribute', '*.removeAttribute', '*.querySelector', '*.querySelectorAll', 'document.createElement',
    'logger.*', 'log.*', 'expect', 'describe', 'it', 'test', 'vi.*',
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/coverage/**',
      '**/.turbo/**',
      // Playwright's traces and HTML report from a local e2e run (gitignored).
      '**/e2e-artifacts/**',
      '**/test-results/**',
      '.claude/**',
      '.spikes/**',
      'third_party/**',
      'fixtures/lint-violations/**',
      'tools/ffmpeg/**',
      // The pinned chrome-headless-shell, fetched for development (pnpm --filter @taalcut/render fetch:shell).
      'packages/render/.cache/**',
      // Vision's model downloads and component builds (gitignored), with the Python venvs of the Core ML packs.
      'packages/vision/.cache/**',
      'tools/whisper/.build/**',
      // The MLX server's SwiftPM checkouts and Xcode build (gitignored; native/mlx-server/build.sh).
      'native/mlx-server/.build/**',
      // The component release cache (gitignored): built objects, and Deno's crates in the notice's cargo home.
      'tools/components/.cache/**',
      'design/logo/**',
      '**/*.gen.ts',
      '**/locales/**/messages.*',
      // The website's Next.js build, its generated types and the brand files copied into it (all gitignored).
      'website/.next/**',
      'website/next-env.d.ts',
      'website/public/brand/**',
      // Throwaway screenshot scripts the lanes and the gate write beside their captures (gitignored).
      'website/.impeccable/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: false, skipComments: false }],
      'no-restricted-imports': ['error', { patterns: [deepImport, modelSdk] }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The one place allowed to talk to model providers.
    files: ['packages/models/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [deepImport] }] },
  },
  {
    files: ['scripts/**', 'tools/**', 'design/scripts/**', 'website/scripts/**', '**/*.config.{ts,js,mjs,cjs}'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/desktop/e2e/**'],
    ignores: ['apps/desktop/e2e/launch.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: electronLaunch, patterns: [deepImport, modelSdk] }],
      // Also through a namespace or dynamic import of Playwright.
      'no-restricted-syntax': [
        'error',
        { selector: "MemberExpression[property.name='_electron']", message: ELECTRON_LAUNCH },
      ],
    },
  },
  {
    // Theme sources that P1-H1 moves into packages/ui and apps/desktop.
    files: ['design/theme/**'],
    languageOptions: { globals: { ...globals.browser } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }] },
  },
  {
    // The website runs in the browser (and is built by Next.js in Node); English only for now (website/SPEC.md).
    files: ['website/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Sandboxed, translated UI.
    files: ['apps/renderer/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { lingui },
    rules: {
      'lingui/no-unlocalized-strings': ['error', linguiOptions],
      'lingui/t-call-in-function': 'error',
      'lingui/no-single-variables-to-translate': 'error',
      'lingui/no-expression-in-message': 'error',
      'lingui/no-trans-inside-trans': 'error',
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/test/**', '**/e2e/**', '**/*.config.{ts,js,mjs,cjs}', '**/*.stories.tsx'],
    rules: { 'lingui/no-unlocalized-strings': 'off' },
  },
);
