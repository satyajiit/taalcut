// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's SfxProvider on ElevenLabs (SPEC P3.2): `POST /v1/sound-generation` with `eleven_text_to_sound_v2`. Sound
 * effects ride on the `music` module (no module of their own). The answer is the file; its `character-cost` header
 * (credits) goes on the CloudCall row, and the US$ figure is the PRD's per-minute estimate.
 */
import {
  err,
  LocalOnly,
  ok,
  ValidationError,
  type AsyncResult,
  type Result,
  type SfxProvider,
  type SfxRequest,
  type SfxResult,
} from '@taalcut/core';
import { ModelProviderError } from '../errors';
import { accountAvailability, runOptions } from './availability';
import { generatedPresence, type PresenceDeps } from './c2pa';
import { ELEVENLABS_LIMITS, ELEVENLABS_MODELS, ELEVENLABS_PROVIDER, type OutputFormat } from './config';
import { elevenLabsCost } from './prices';
import type { ElevenLabsSession } from './session';
import type { WireCall, WireResponse } from './wire-types';

export interface ElevenLabsSfxDeps extends PresenceDeps {
  readonly session: ElevenLabsSession;
}

const MODEL = ELEVENLABS_MODELS.soundEffect;

function checkEffect(request: SfxRequest): Result<void> {
  const { sfxSeconds, sfxText } = ELEVENLABS_LIMITS;
  if (request.text.trim().length === 0 || request.text.length > sfxText)
    return err(ValidationError({ field: 'text' }));
  if (!(request.durationSeconds >= sfxSeconds.min && request.durationSeconds <= sfxSeconds.max))
    return err(ValidationError({ field: 'durationSeconds' }));
  if (!(request.promptInfluence >= 0 && request.promptInfluence <= 1))
    return err(ValidationError({ field: 'promptInfluence' }));
  return ok(undefined);
}

/** The credits the `character-cost` header says the effect took, when it says. */
function bill(seconds: number, response: WireResponse) {
  const credits = Number(response.headers.get('character-cost') ?? Number.NaN);
  const billed =
    Number.isFinite(credits) && credits >= 0 ? { unit: 'credit' as const, quantity: credits } : null;
  return { ...(billed ? { billed } : {}), costUsd: elevenLabsCost(MODEL, seconds) };
}

function effectCall(request: SfxRequest, format: OutputFormat): WireCall {
  return {
    module: 'music',
    model: MODEL,
    method: 'POST',
    path: '/v1/sound-generation',
    query: { output_format: format.id },
    json: {
      text: request.text,
      model_id: MODEL,
      duration_seconds: request.durationSeconds,
      loop: request.loop,
      prompt_influence: request.promptInfluence,
    },
    bill: (response) => bill(request.durationSeconds, response),
    ...runOptions(request),
  };
}

async function generate(deps: ElevenLabsSfxDeps, request: SfxRequest): AsyncResult<SfxResult> {
  if (deps.session.http.localOnly()) return err(LocalOnly({ what: 'model' }));
  const checked = checkEffect(request);
  if (!checked.ok) return checked;
  const format = await deps.session.outputFormat('music', request.signal);
  if (!format.ok) return format;
  const answer = await deps.session.http.send(effectCall(request, format.value));
  if (!answer.ok) return answer;
  const bytes = answer.value.bytes;
  if (bytes.byteLength === 0)
    return err(
      ModelProviderError({ provider: ELEVENLABS_PROVIDER, model: MODEL }, { detail: 'Empty sound.' }),
    );
  return ok({
    bytes,
    mediaType: 'audio/mpeg',
    provider: ELEVENLABS_PROVIDER,
    model: MODEL,
    costUsd: elevenLabsCost(MODEL, request.durationSeconds),
    c2pa: await generatedPresence(deps, bytes, 'absent', request.signal),
  });
}

export function createElevenLabsSfx(deps: ElevenLabsSfxDeps): SfxProvider {
  return {
    available: () => accountAvailability(deps.session.http),
    generate: (request) => generate(deps, request),
  };
}
