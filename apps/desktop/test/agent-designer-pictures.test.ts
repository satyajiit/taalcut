// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-DSN: the Designer outside a run sees its frames as pictures only where the person's consent allows. The make's
 * frame checks draw over the person's footage: to a cloud model, pictures only under a standing upload consent for
 * the agent's module that covers every provider its chain may call; otherwise the checks in words, never a card
 * mid-make. A template's reading sends the reel's own frames; on this Mac, nothing leaves.
 */
import { describe, expect, it } from 'vitest';
import type { UploadConsent } from '@taalcut/agent';
import { designerSeesPictures, type DesignerPictureFacts } from '../src/utility/roots/agent-designer';

const granted = (providers: readonly string[]): UploadConsent => ({
  id: 'c1',
  module: 'agent',
  providers,
  grantedAt: 1,
});

function facts(
  overrides: Partial<DesignerPictureFacts> & { readonly consented?: UploadConsent },
): DesignerPictureFacts {
  const { consented, ...rest } = overrides;
  return {
    frames: 'footage',
    sees: true,
    localOnly: false,
    cloudProviders: ['openai'],
    consent: async () => consented,
    ...rest,
  };
}

describe('the Designer’s pictures outside a run', () => {
  it('uses the current tool approval only for providers covered by that approval', async () => {
    expect(await designerSeesPictures(facts({ approvedProviders: ['openai'] }))).toBe(true);
    expect(
      await designerSeesPictures(
        facts({ cloudProviders: ['openai', 'google'], approvedProviders: ['openai'] }),
      ),
    ).toBe(false);
  });
  it('sends the person’s footage to a cloud model only under a standing consent that covers its providers', async () => {
    expect(await designerSeesPictures(facts({}))).toBe(false);
    expect(await designerSeesPictures(facts({ consented: granted(['openai']) }))).toBe(true);
    // A provider added to the chain since needs a consent of its own.
    expect(
      await designerSeesPictures(
        facts({ cloudProviders: ['openai', 'gemini'], consented: granted(['openai']) }),
      ),
    ).toBe(false);
  });

  it('shows a reel’s own frames, and anything on this Mac, without asking; a model that can’t see gets words', async () => {
    let asked = 0;
    const consent = async () => {
      asked++;
      return undefined;
    };
    expect(await designerSeesPictures(facts({ frames: 'reel', consent }))).toBe(true);
    expect(await designerSeesPictures(facts({ cloudProviders: [], consent }))).toBe(true);
    expect(await designerSeesPictures(facts({ localOnly: true, consent }))).toBe(true);
    expect(asked).toBe(0);
    expect(await designerSeesPictures(facts({ sees: false, consented: granted(['openai']) }))).toBe(false);
  });
});
