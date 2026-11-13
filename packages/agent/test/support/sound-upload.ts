// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `audio.cloudCritique` as the consent tests see it (EAR1-I5, EAR1-R3): the real tool's metadata (side effect, cloud
 * modules, the media it uploads, alwaysAsk), with a run that only records which sound would have gone. `alwaysAsk`
 * can be turned off to stand for an audio upload that doesn't ask every time.
 */
import { defineTool, defineToolModule, ok } from '@taalcut/core';
import { consentKey } from '@taalcut/agent';
import { createCloudCritiqueTool, type CloudCritiqueDeps } from '@taalcut/models';
import { z } from 'zod';
import { call } from './harness';

export const SOUND_KEY = consentKey('vision', 'audio');
export const FRAMES = { id: 'frames-1', module: 'vision', providers: ['google'], grantedAt: 1 };

export const realCritique = () =>
  createCloudCritiqueTool({
    chain: () => [{ provider: 'google', model: 'gemini-3.8-flash' }],
    runtime: { findModel: () => undefined },
  } as unknown as CloudCritiqueDeps);

export function soundModule(sent: string[], options: { readonly alwaysAsk?: boolean } = {}) {
  const real = realCritique();
  return defineToolModule({
    id: 'audio',
    tools: [
      defineTool({
        name: real.name,
        version: real.version,
        description: real.description,
        summary: 'Uploads a sound for a critique in words, after the person allows it.',
        input: z.object({ assetId: z.string() }),
        output: z.object({ heard: z.boolean() }),
        costClass: real.costClass,
        sideEffect: real.sideEffect,
        alwaysAsk: options.alwaysAsk ?? real.alwaysAsk === true,
        timeoutMs: real.timeoutMs,
        retry: real.retry,
        permission: real.permission,
        idempotencyKey: (input) => input.assetId,
        estimateCost: () => ({ usd: 0.01, tokens: 14_000 }),
        run: async (input) => {
          sent.push(input.assetId);
          return ok({ heard: true });
        },
      }),
    ],
  });
}

export const critique = (assetId: string) => ({ toolCalls: [call('audio_cloudCritique', { assetId })] });
