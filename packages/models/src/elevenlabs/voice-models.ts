// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which ElevenLabs model a voice quality runs on (SPEC P3.2): drafts on the chain's first draft model, finals on its
 * first final model, a chain with one model uses it for both. The voice module's chain comes from the active profile
 * (Balanced: v4 then turbo; Fast and cheap: turbo only); without a selector the built-in pair is used.
 */
import { err, ok, type Result } from '@taalcut/core';
import type { ModelSelector } from '../client/model-client';
import { NoModelForModule } from '../errors';
import { ELEVENLABS_MODELS, ELEVENLABS_PROVIDER, VOICE_MODEL_ROLES } from './config';

/** ElevenLabs' text-to-speech models in the voice chain, in order; null with no selector. */
export function voiceChain(selector: ModelSelector | undefined): Result<readonly string[] | null> {
  if (!selector) return ok(null);
  const chain = selector.resolve('voice');
  if (!chain.ok) return chain;
  return ok(
    chain.value.choices
      .filter((choice) => choice.provider === ELEVENLABS_PROVIDER)
      .map((choice) => choice.model),
  );
}

export function voiceModelFor(quality: 'draft' | 'final', chain: readonly string[] | null): Result<string> {
  if (chain === null) return ok(ELEVENLABS_MODELS[quality]);
  const role = (model: string) => VOICE_MODEL_ROLES[model] ?? 'both';
  const fitting = chain.find((model) => role(model) === quality || role(model) === 'both');
  const model = fitting ?? chain[0];
  return model ? ok(model) : err(NoModelForModule({ module: 'voice' }));
}
