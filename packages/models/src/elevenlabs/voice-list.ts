// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The voices the account can use (`GET /v2/voices`, paged by `next_page_token`); names are provider text. */
import { ok, type AsyncResult, type SpokenLanguage, type VoiceSummary } from '@taalcut/core';
import { ELEVENLABS_LIMITS } from './config';
import type { ElevenLabsHttp } from './http';
import { voicePageSchema, voiceSummaries } from './voice-wire';
import { parseWire } from './wire-parse';

const MODEL = 'api:voices';

export async function listVoices(
  http: ElevenLabsHttp,
  filter: { readonly language?: SpokenLanguage; readonly signal?: AbortSignal },
): AsyncResult<VoiceSummary[]> {
  const voices: VoiceSummary[] = [];
  let token: string | undefined;
  for (let page = 0; page < ELEVENLABS_LIMITS.voicePages; page += 1) {
    const answer = await http.send({
      module: 'voice',
      model: MODEL,
      method: 'GET',
      path: '/v2/voices',
      query: {
        page_size: String(ELEVENLABS_LIMITS.voicePageSize),
        ...(token ? { next_page_token: token } : {}),
      },
      ...(filter.signal ? { signal: filter.signal } : {}),
    });
    if (!answer.ok) return answer;
    const parsed = parseWire(voicePageSchema, answer.value, MODEL);
    if (!parsed.ok) return parsed;
    voices.push(...voiceSummaries(parsed.value.voices, filter.language));
    token = parsed.value.next_page_token ?? undefined;
    if (!parsed.value.has_more || !token) break;
  }
  return ok(voices);
}
