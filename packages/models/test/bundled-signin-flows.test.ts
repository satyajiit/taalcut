// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-IMGLOAD: pi-ai loads its sign-in flows through a variable import a bundler cannot follow, so the desktop's
 * bundled main looked for `openai-codex.js` beside its own bundle and the ChatGPT images sign-in failed before it
 * began (the owner, 2026-11-14 and 15). The runtime registers the flows, which puts them in the bundle.
 *
 * Unbundled, as here, the variable import works either way, so this only holds the registration in place. That a
 * bundle then loads the flow was shown with a scratch bundle and in the built app (packages/models/SPEC.md).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@earendil-works/pi-ai/bun-oauth', () => ({ registerBunOAuthFlows: vi.fn() }));

describe('pi-ai’s sign-in flows in a bundled build', () => {
  it('are registered when the runtime is made, before any provider can sign in', async () => {
    const { registerBunOAuthFlows } = await import('@earendil-works/pi-ai/bun-oauth');
    const { createModelRuntime } = await import('../src/runtime/runtime');
    expect(registerBunOAuthFlows).not.toHaveBeenCalled();
    createModelRuntime();
    expect(registerBunOAuthFlows).toHaveBeenCalledTimes(1);
  });
});
