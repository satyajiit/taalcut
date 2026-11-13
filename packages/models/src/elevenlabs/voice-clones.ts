// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Own-voice instant clones (SPEC P3.2): `POST /v1/voices/add` with the in-app consent recording and nothing else
 * (the caller has checked the consent), and `DELETE /v1/voices/{id}`, where an unknown voice is success.
 * `requiresVerification` comes back in the result so the caller keeps the voice id and can delete it.
 */
import { basename } from 'node:path';
import { err, LocalOnly, ok, ValidationError, type AsyncResult, type VoiceProvider } from '@taalcut/core';
import type { ElevenLabsHttp } from './http';
import { cloneSchema } from './voice-wire';
import { parseWire } from './wire-parse';

export type ReadFile = (path: string) => Promise<Uint8Array>;
type CloneRequest = Parameters<VoiceProvider['createClone']>[0];

async function readRecording(readFile: ReadFile, path: string): AsyncResult<Uint8Array> {
  try {
    return ok(await readFile(path));
  } catch (cause) {
    // The path came from the consent store: a file that can't be read is a missing recording, said plainly.
    const code = cause instanceof Error && 'code' in cause ? String(cause.code) : 'unreadable';
    return err(
      ValidationError(
        { field: 'recordingPath' },
        { detail: `The consent recording can't be read (${code}).` },
      ),
    );
  }
}

export async function createVoiceClone(
  http: ElevenLabsHttp,
  readFile: ReadFile,
  request: CloneRequest,
): AsyncResult<{ readonly voiceId: string; readonly requiresVerification: boolean }> {
  if (http.localOnly()) return err(LocalOnly({ what: 'upload' }));
  const recording = await readRecording(readFile, request.recordingPath);
  if (!recording.ok) return recording;
  const name = request.name.trim().slice(0, 60);
  const fileName = basename(request.recordingPath);
  const form = new FormData();
  form.set('name', name);
  form.set('remove_background_noise', 'false');
  form.append('files', new Blob([new Uint8Array(recording.value)], { type: 'audio/wav' }), fileName);
  const answer = await http.send({
    module: 'voice',
    model: 'api:voices.add',
    method: 'POST',
    path: '/v1/voices/add',
    form,
    formBytes: recording.value.byteLength + Buffer.byteLength(name) + Buffer.byteLength(fileName),
    ...(request.signal ? { signal: request.signal } : {}),
  });
  if (!answer.ok) return answer;
  const clone = parseWire(cloneSchema, answer.value, 'api:voices.add');
  if (!clone.ok) return clone;
  return ok({
    voiceId: clone.value.voice_id,
    requiresVerification: clone.value.requires_verification === true,
  });
}

export async function deleteVoiceClone(
  http: ElevenLabsHttp,
  voiceId: string,
  signal?: AbortSignal,
): AsyncResult<void> {
  const answer = await http.send({
    module: 'voice',
    model: 'api:voices.delete',
    method: 'DELETE',
    path: `/v1/voices/${encodeURIComponent(voiceId)}`,
    notFoundOk: true,
    ...(signal ? { signal } : {}),
  });
  return answer.ok ? ok(undefined) : answer;
}
