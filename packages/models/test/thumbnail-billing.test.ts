// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, ok } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { createGenerateThumbnailTool } from '../src/images/thumbnail-tool';
import type { ImageToolDeps } from '../src/images/thumbnail-tool-io';
import type { ImageProvider } from '../src/images/image-types';
import { GROK, png, selectorOf } from './support/image-wire';

function setup() {
  let signedIn = true;
  let signOutAfterImage = false;
  const generated: string[] = [];
  function provider(id: string, access: 'subscription' | 'openrouter'): ImageProvider {
    return {
      id,
      access,
      models: () => [GROK.model],
      modelFor: () => GROK.model,
      available: async () =>
        access === 'subscription' && !signedIn
          ? { ok: false, reason: 'not_configured' }
          : { ok: true, access },
      estimate: (_model, request) =>
        access === 'subscription' ? null : { usd: 0.04 * request.count, estimated: false },
      generate: async (_model, request) => {
        generated.push(id);
        if (signOutAfterImage) signedIn = false;
        return ok(
          Array.from({ length: request.count }, () => ({
            provider: id,
            model: GROK.model,
            access,
            costUsd: access === 'subscription' ? 0 : 0.04,
            bytes: png(8, 8),
            mediaType: 'image/png' as const,
            width: 8,
            height: 8,
            c2pa: 'unknown' as const,
          })),
        );
      },
    };
  }
  const deps: ImageToolDeps = {
    providers: [provider('xai', 'subscription'), provider('openrouter', 'openrouter')],
    selector: selectorOf(GROK),
    sink: { put: vi.fn(), storeGeneratedStill: async () => ok({ assetId: newId<'Asset'>() }) },
    timelines: { get: vi.fn() },
  };
  const ctx = {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    attempt: 1,
    artifacts: { put: vi.fn(), get: vi.fn() },
    reportUsage: vi.fn(),
    reportProgress: vi.fn(),
  };
  const tool = createGenerateThumbnailTool(deps);
  const input = tool.input.parse({
    projectId: newId<'Project'>(),
    prompt: 'Airport poster illustration',
    hookText: 'Never gets old',
    aspects: ['9:16', '16:9'],
    takes: 2,
  });
  return {
    tool,
    ctx,
    input,
    generated,
    signOut: () => {
      signedIn = false;
    },
    expireAfterImage: () => {
      signOutAfterImage = true;
    },
  };
}

describe('thumbnail invocation billing', () => {
  it('counts takes across unique aspects while recording subscription allowance rather than API spend', async () => {
    const test = setup();
    const estimate = await test.tool.refineCost!(
      { ...test.input, aspects: ['9:16', '16:9', '9:16'] },
      test.ctx,
    );
    expect(estimate.ok && estimate.value).toMatchObject({
      usd: 0,
      billing: 'subscription',
      billed: { unit: 'image', quantity: 4 },
    });
    expect(test.generated).toEqual([]);
  });

  it('does not spend a paid key after the subscription estimate was authorized and the person signed out', async () => {
    const test = setup();
    const estimate = await test.tool.refineCost!(test.input, test.ctx);
    if (!estimate.ok) throw new Error(estimate.error.code);
    test.signOut();
    const made = await test.tool.run(test.input, { ...test.ctx, estimate: estimate.value });
    expect(!made.ok && made.error.code).toBe('models.image_access_denied');
    expect(test.generated).toEqual([]);
  });

  it('pins subscription billing across all aspects even for direct tool calls without an estimate', async () => {
    const test = setup();
    test.expireAfterImage();
    const made = await test.tool.run(test.input, test.ctx);
    expect(!made.ok && made.error.code).toBe('models.image_access_denied');
    expect(test.generated).toEqual(['xai']);
    expect(test.ctx.reportUsage).not.toHaveBeenCalled();
  });
});
