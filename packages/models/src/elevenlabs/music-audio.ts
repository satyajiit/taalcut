// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The audio of a `/v1/music/detailed` answer: the audio part of its `multipart/mixed` body (the other part is the plan
 * used, as JSON), or the whole body when the answer is plain audio. Kept byte for byte.
 */
import { err, ok, type Result } from '@taalcut/core';
import { ModelProviderError } from '../errors';
import { ELEVENLABS_MODELS, ELEVENLABS_PROVIDER } from './config';
import { boundaryOf, parseMultipart } from './multipart';
import type { WireResponse } from './wire-types';

const isAudio = (type: string | null | undefined) => (type ?? '').toLowerCase().startsWith('audio/');

function audioOf(response: WireResponse): Uint8Array | undefined {
  const contentType = response.headers.get('content-type');
  const boundary = boundaryOf(contentType);
  if (!boundary) return isAudio(contentType) ? response.bytes : undefined;
  return parseMultipart(response.bytes, boundary).find((part) => isAudio(part.headers['content-type']))?.body;
}

export function musicAudio(response: WireResponse): Result<Uint8Array> {
  const audio = audioOf(response);
  if (audio && audio.byteLength > 0) return ok(new Uint8Array(audio));
  const contentType = response.headers.get('content-type') ?? 'no content type';
  return err(
    ModelProviderError(
      { provider: ELEVENLABS_PROVIDER, model: ELEVENLABS_MODELS.music },
      { detail: `No audio part in the answer (${contentType}).` },
    ),
  );
}
