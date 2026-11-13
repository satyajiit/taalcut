// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One script line as speech with character timings (SPEC P3.2): `POST /v1/text-to-speech/{voice_id}/with-timestamps`
 * on the model the quality and the profile's voice chain pick, at the format the plan allows. Eleven v4 takes no
 * speed or style, so none is sent; billed by characters.
 */
import {
  err,
  LocalOnly,
  ok,
  ValidationError,
  type AsyncResult,
  type Result,
  type SynthesisRequest,
  type SynthesisResult,
} from '@taalcut/core';
import type { ModelSelector } from '../client/model-client';
import { runOptions } from './availability';
import { generatedPresence, type PresenceDeps } from './c2pa';
import { ELEVENLABS_LIMITS, ELEVENLABS_PROVIDER, OUTPUT_FORMATS } from './config';
import { elevenLabsCost } from './prices';
import type { ElevenLabsSession } from './session';
import { characterAlignment, speechSchema } from './voice-wire';
import { voiceChain, voiceModelFor } from './voice-models';
import { parseWire } from './wire-parse';
import type { WireCall } from './wire-types';

export interface SynthesizeDeps extends PresenceDeps {
  readonly session: ElevenLabsSession;
  readonly selector?: ModelSelector;
}

interface SpeechFormat {
  readonly id: string;
  readonly sampleRate: number;
}

const MAX_SEED = 4_294_967_295;

/** ISO 639-1, as the API's `language_code` wants it ('pt-BR' → 'pt'). */
const languageCode = (tag: string) => (tag.toLowerCase().split('-')[0] ?? tag).slice(0, 3);

function checkLine(request: SynthesisRequest): Result<void> {
  const text = request.text.trim();
  if (text.length === 0 || request.text.length > ELEVENLABS_LIMITS.textCharacters)
    return err(ValidationError({ field: 'text' }, { detail: 'A line has 1 to 5,000 characters.' }));
  const seed = request.seed;
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) return err(ValidationError({ field: 'seed' }));
  return ok(undefined);
}

function speechCall(request: SynthesisRequest, model: string, format: SpeechFormat): WireCall {
  const characters = request.text.length;
  return {
    module: 'voice',
    model,
    method: 'POST',
    path: `/v1/text-to-speech/${encodeURIComponent(request.voiceId)}/with-timestamps`,
    query: { output_format: format.id },
    json: {
      text: request.text,
      model_id: model,
      language_code: languageCode(request.language),
      seed: request.seed,
      ...(request.previousText ? { previous_text: request.previousText } : {}),
      ...(request.nextText ? { next_text: request.nextText } : {}),
    },
    bill: () => ({
      billed: { unit: 'character', quantity: characters },
      costUsd: elevenLabsCost(model, characters),
    }),
    ...runOptions(request),
  };
}

const FALLBACK_FORMATS: readonly SpeechFormat[] = [
  { id: 'mp3_44100_192', sampleRate: 44_100 },
  OUTPUT_FORMATS.standard,
];

const isFormatError = (detail: string | undefined) =>
  typeof detail === 'string' && /invalid_output_format|output_format/i.test(detail);

export async function synthesizeLine(
  deps: SynthesizeDeps,
  request: SynthesisRequest,
): AsyncResult<SynthesisResult> {
  if (deps.session.http.localOnly()) return err(LocalOnly({ what: 'model' }));
  const checked = checkLine(request);
  if (!checked.ok) return checked;
  const chain = voiceChain(deps.selector);
  if (!chain.ok) return chain;
  const model = voiceModelFor(request.quality, chain.value);
  if (!model.ok) return model;
  const format = await deps.session.outputFormat('voice', request.signal);
  if (!format.ok) return format;
  let chosenFormat: SpeechFormat = format.value;
  let answer = await deps.session.http.send(speechCall(request, model.value, chosenFormat));
  if (!answer.ok && isFormatError(answer.error.detail)) {
    for (const candidate of FALLBACK_FORMATS) {
      if (candidate.id === chosenFormat.id) continue;
      chosenFormat = candidate;
      answer = await deps.session.http.send(speechCall(request, model.value, chosenFormat));
      if (answer.ok || !isFormatError(answer.error.detail)) break;
    }
  }
  if (!answer.ok) return answer;
  const speech = parseWire(speechSchema, answer.value, model.value);
  if (!speech.ok) return speech;
  const bytes = new Uint8Array(Buffer.from(speech.value.audio_base64, 'base64'));
  return ok({
    bytes,
    mediaType: 'audio/mpeg',
    sampleRate: chosenFormat.sampleRate,
    alignment: characterAlignment(speech.value),
    provider: ELEVENLABS_PROVIDER,
    model: model.value,
    costUsd: elevenLabsCost(model.value, request.text.length),
    c2pa: await generatedPresence(deps, bytes, 'absent', request.signal),
  });
}
