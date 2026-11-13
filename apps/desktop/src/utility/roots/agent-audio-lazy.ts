// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The tools' views of audio's services (agent-audio-services.ts), which are built on first use: each method waits
 * for the services and answers their error (no FFmpeg) when they can't be built. And the estimate of one caption
 * translation at the agent chain's price.
 */
import type { AsyncResult, Container, ToolCostEstimate } from '@taalcut/core';
import type { MusicToolDeps, SfxToolDeps, VoiceToolDeps } from '@taalcut/audio';
import { createPriceLookup } from '@taalcut/models';
import { ModelProfilesToken, ModelRuntimeToken } from '../../shared/tokens';
import type { AudioAgentServices } from './agent-audio-services';

type Services = () => AsyncResult<AudioAgentServices>;

export function lazyVoiceover(services: Services): VoiceToolDeps['voiceover'] {
  return {
    async generate(request) {
      const built = await services();
      return built.ok ? built.value.voiceover.generate(request) : built;
    },
    async editLine(request) {
      const built = await services();
      return built.ok ? built.value.voiceover.editLine(request) : built;
    },
    async place(request) {
      const built = await services();
      return built.ok ? built.value.voiceover.place(request) : built;
    },
    async finalize(request) {
      const built = await services();
      return built.ok ? built.value.voiceover.finalize(request) : built;
    },
  };
}

export function lazyMusic(services: Services): MusicToolDeps['generator'] {
  return {
    async generate(request) {
      const built = await services();
      return built.ok ? built.value.music.generate(request) : built;
    },
  };
}

export function lazySfx(services: Services): SfxToolDeps['service'] {
  return {
    async addHits(request) {
      const built = await services();
      return built.ok ? built.value.sfx.addHits(request) : built;
    },
    async generateHit(request) {
      const built = await services();
      return built.ok ? built.value.sfx.generateHit(request) : built;
    },
  };
}

/** A caption track of about three minutes: its words in, their translation out (and once more, shorter). */
const TRANSLATION_TOKENS = { input: 6_000, output: 6_000 } as const;

/** One caption track's translation at the agent chain's first priced model; US$0 on this Mac. */
export function translationEstimate(container: Container): () => ToolCostEstimate {
  const prices = createPriceLookup({
    selector: container.resolve(ModelProfilesToken),
    runtime: container.resolve(ModelRuntimeToken),
  });
  return () => {
    const price = prices.price('agent');
    if (!price || price.local) return { usd: 0, basis: 'the agent chain runs on this Mac' };
    const usd =
      (TRANSLATION_TOKENS.input * price.usdPerMTok.input +
        TRANSLATION_TOKENS.output * price.usdPerMTok.output) /
      1_000_000;
    return {
      usd: Math.round(usd * 1_000_000) / 1_000_000,
      tokens: TRANSLATION_TOKENS.input + TRANSLATION_TOKENS.output,
      basis: `about ${TRANSLATION_TOKENS.input} tokens in and out (a three-minute caption track) on ${price.model}`,
    };
  };
}
