// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Content Security Policy and the other response headers for app:// pages.
 * Sent as HTTP headers by the app:// handler (a <meta> tag can't set
 * frame-ancestors, and a header can't be removed by the page).
 */

import { APP_CSP, APP_CSP_DIRECTIVES, serializeCsp } from '@taalcut/core';

/** The production policy lives in @taalcut/core, shared with the renderer's `vite preview`. */
export { APP_CSP, APP_CSP_DIRECTIVES, serializeCsp };

/**
 * Development only, for pages served by the Vite dev server. Loosened because
 * Vite's React refresh preamble is an inline script, Vite injects CSS as
 * <style> tags, and HMR talks over a WebSocket. Never used in a packaged build
 * (resolveRuntime drops the dev server there).
 */
export function devServerCsp(devServerOrigin: string): string {
  const ws = devServerOrigin.replace(/^http:/, 'ws:');
  return serializeCsp({
    ...APP_CSP_DIRECTIVES,
    'script-src': ["'self'", "'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'connect-src': ["'self'", ws],
  });
}

/** Headers on every app:// response. CSP on assets matters too: workers take theirs from it. */
export function appResponseHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': APP_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}
