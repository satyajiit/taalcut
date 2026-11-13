// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's MusicProvider on ElevenLabs (SPEC P3.2): `POST /v1/music/detailed` with `music_v2_5`, a composition plan
 * checked before sending (music-plan.ts), MP3 at the best rate the plan allows, and the multipart answer's audio kept
 * byte for byte (music-audio.ts) with the `song-id` header. Free has no Music API: refused before the request
 * (`models.plan_required`). The price is an estimate (no fixed rate is published).
 */
import {
  err,
  LocalOnly,
  ok,
  type AsyncResult,
  type GenerationAvailability,
  type MusicProvider,
  type MusicRequest,
  type MusicResult,
} from '@taalcut/core';
import { accountAvailability, runOptions } from './availability';
import { generatedPresence, type PresenceDeps } from './c2pa';
import { ELEVENLABS_MODELS, ELEVENLABS_PROVIDER, type OutputFormat } from './config';
import { ModelPlanRequired } from './errors';
import { musicAudio } from './music-audio';
import { musicBody, type MusicBody } from './music-plan';
import { elevenLabsCost } from './prices';
import { isFreeTier, type ElevenLabsSession } from './session';
import type { WireCall } from './wire-types';

export interface ElevenLabsMusicDeps extends PresenceDeps {
  readonly session: ElevenLabsSession;
}

const MODEL = ELEVENLABS_MODELS.music;

function musicAvailability(session: ElevenLabsSession): GenerationAvailability {
  const account = accountAvailability(session.http);
  if (!account.ok) return account;
  return isFreeTier(session.knownTier()) ? { ok: false, reason: 'plan_required' } : account;
}

/** The checked body and the format the account's plan allows; music on Free is refused here. */
async function prepare(
  session: ElevenLabsSession,
  request: MusicRequest,
): AsyncResult<[MusicBody, OutputFormat]> {
  if (session.http.localOnly()) return err(LocalOnly({ what: 'model' }));
  const body = musicBody(request);
  if (!body.ok) return body;
  const tier = await session.tier('music', request.signal);
  if (!tier.ok) return tier;
  if (isFreeTier(tier.value))
    return err(ModelPlanRequired({ provider: ELEVENLABS_PROVIDER, feature: 'music' }));
  const format = await session.outputFormat('music', request.signal);
  return format.ok ? ok([body.value, format.value]) : format;
}

function musicCall(request: MusicRequest, body: MusicBody, format: OutputFormat): WireCall {
  const seconds = body.lengthMs / 1000;
  return {
    module: 'music',
    model: MODEL,
    method: 'POST',
    path: '/v1/music/detailed',
    query: { output_format: format.id },
    json: body.body,
    bill: () => ({ billed: { unit: 'second', quantity: seconds }, costUsd: elevenLabsCost(MODEL, seconds) }),
    ...runOptions(request),
  };
}

async function compose(deps: ElevenLabsMusicDeps, request: MusicRequest): AsyncResult<MusicResult> {
  const prepared = await prepare(deps.session, request);
  if (!prepared.ok) return prepared;
  const [body, format] = prepared.value;
  const answer = await deps.session.http.send(musicCall(request, body, format));
  if (!answer.ok) return answer;
  const bytes = musicAudio(answer.value);
  if (!bytes.ok) return bytes;
  return ok({
    bytes: bytes.value,
    mediaType: 'audio/mpeg',
    provider: ELEVENLABS_PROVIDER,
    model: MODEL,
    songId: answer.value.headers.get('song-id'),
    costUsd: elevenLabsCost(MODEL, body.lengthMs / 1000),
    estimated: true,
    // Without a reader, a signed request is 'unknown', never claimed signed.
    c2pa: await generatedPresence(deps, bytes.value, 'unknown', request.signal),
  });
}

export function createElevenLabsMusic(deps: ElevenLabsMusicDeps): MusicProvider {
  return {
    available: () => musicAvailability(deps.session),
    compose: (request) => compose(deps, request),
  };
}
