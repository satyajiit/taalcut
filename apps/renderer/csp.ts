// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Content Security Policy the desktop app serves with every document
 * (APP_CSP in @taalcut/core). `vite preview` sends the same header so the
 * end-to-end tests catch violations before Electron does. A copy, because
 * vite.config.ts loads before any TypeScript transform can reach core;
 * test/csp.test.ts fails if the two drift apart.
 *
 * What it rules out for renderer code: inline <script> and <style> elements,
 * eval, fonts from data: URLs (so Vite must never inline assets), frames,
 * forms that submit, and any request to another origin.
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: app://media app://preview; media-src 'self' blob: app://media app://preview; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-src app://preview; manifest-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
