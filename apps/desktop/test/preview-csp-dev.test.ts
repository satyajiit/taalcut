// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The preview's CSP per run: a packaged app is framed only by app://taalcut;
 * development with the Vite dev server adds that loopback origin, so the
 * player isn't blocked under `pnpm dev`. Every response, errors included,
 * carries the run's policy.
 */
import { describe, expect, it } from 'vitest';
import { PREVIEW_CSP } from '@taalcut/core';
import { previewCspFor, servePreview } from '../src/main/render/preview-protocol';

const ancestors = (csp: string) => csp.split('; ').find((part) => part.startsWith('frame-ancestors'));

describe('previewCspFor', () => {
  it('is PREVIEW_CSP when packaged or without a dev server', () => {
    expect(previewCspFor({ packaged: true, devServerOrigin: undefined })).toBe(PREVIEW_CSP);
    expect(previewCspFor({ packaged: false, devServerOrigin: undefined })).toBe(PREVIEW_CSP);
  });

  it('lets the dev server frame the preview in development', () => {
    const csp = previewCspFor({ packaged: false, devServerOrigin: 'http://localhost:5173' });
    expect(ancestors(csp)).toBe('frame-ancestors app://taalcut http://localhost:5173');
    // Everything else is the packaged policy.
    expect(csp.replace(ancestors(csp)!, '')).toBe(PREVIEW_CSP.replace(ancestors(PREVIEW_CSP)!, ''));
  });

  it('never widens a packaged app, whatever the runtime says', () => {
    expect(previewCspFor({ packaged: true, devServerOrigin: 'http://localhost:5173' })).toBe(PREVIEW_CSP);
  });

  it('is sent on every app://preview response, errors too', async () => {
    const csp = previewCspFor({ packaged: false, devServerOrigin: 'http://127.0.0.1:5173' });
    const roots = { preview: '/nonexistent/preview', allowed: [] };
    const response = await servePreview(new Request('app://preview/../x'), roots, undefined, csp);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get('content-security-policy')).toBe(csp);
  });
});
