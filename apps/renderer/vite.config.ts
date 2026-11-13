// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { lingui } from '@lingui/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { CONTENT_SECURITY_POLICY } from './csp.ts';
import pkg from './package.json' with { type: 'json' };
import { sampleMedia } from './e2e/sample-media/server.ts';

const THEME_BOOT_FILE = 'theme-boot.js';

/**
 * Serves @taalcut/ui's web-boot.js at /theme-boot.js and copies it into dist/.
 * index.html loads it as a classic script in <head> so a stored theme applies
 * before first paint. It must be a file, not inline, because of the CSP.
 */
function themeBoot(): Plugin {
  const file = createRequire(import.meta.url).resolve('@taalcut/ui/web-boot.js');
  const source = () => readFileSync(file, 'utf8');
  return {
    name: 'taalcut:theme-boot',
    configureServer(server) {
      server.middlewares.use(`/${THEME_BOOT_FILE}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.end(source());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: THEME_BOOT_FILE, source: source() });
    },
  };
}

export default defineConfig({
  // The desktop app serves dist/ at app://taalcut/ with an SPA fallback, so
  // absolute paths and browser history work there as they do here.
  base: '/',
  define: { __TAALCUT_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    // Each route's components load as their own chunk, on first visit (or on
    // hover, with defaultPreload: 'intent'), so the entry stays small.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    lingui({ macroTransform: true, failOnCompileError: true }),
    react(),
    tailwindcss(),
    themeBoot(),
    // The fake backend's sample clips (UX2): served by dev and preview only, never built in.
    sampleMedia(),
  ],
  resolve: {
    alias: [
      {
        // Radix's scroll lock (react-remove-scroll) injects a <style> element,
        // which style-src 'self' blocks. This drop-in uses a constructed
        // stylesheet instead, which CSP allows.
        find: /^react-style-singleton$/,
        replacement: fileURLToPath(new URL('./src/csp/style-singleton.ts', import.meta.url)),
      },
    ],
  },
  build: {
    // Never inline assets as data: URLs: font-src 'self' would block inlined fonts.
    assetsInlineLimit: 0,
    target: 'chrome140',
  },
  server: { port: 5173 },
  preview: {
    port: 4517,
    strictPort: true,
    headers: { 'Content-Security-Policy': CONTENT_SECURITY_POLICY },
  },
});
