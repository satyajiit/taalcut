// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- error details as the real handlers write them: data for logs, not UI */

/**
 * P3-B6: main's microphone for a voice consent (appContract.voiceCapture) as the fake answers it: the
 * permission, a capture that takes PCM chunks in order and finishes as a WAV key. fake-phase3.ts serves `router`
 * as the `voiceCapture` namespace. Main's checks, mirrored (apps/desktop main/voice): captures are 48 kHz 16-bit
 * mono, a chunk is the next number in order and an even number of bytes, ten minutes at most; a capture that isn't
 * recording (or stopped, for cancel) is core.not_found. `captures.claim` is what voice.recordConsent takes a
 * stopped capture from (fake-media-commands.ts). Also the media area's arrangement for /dev/kit (media-arrange.ts).
 */
import {
  appContract,
  err,
  implementContract,
  newId,
  NotFoundError,
  ok,
  toRpcError,
  ValidationError,
  type MICROPHONE_PERMISSIONS,
  type Result,
  type VoiceConsentId,
} from '@taalcut/core';
import { arrangeMedia } from './media-arrange';
import type { Phase3Deps } from './phase3-deps';

type Permission = (typeof MICROPHONE_PERMISSIONS)[number];

export interface FakeVoiceCaptureOptions {
  /** The macOS microphone permission the fake reports; the default is granted. */
  readonly permission?: Permission;
  /** What the person answers when macOS asks (permission 'not-determined'); the default is granted. */
  readonly answer?: 'granted' | 'denied';
  /** Put the media cards' voiceovers, graphics and image slots on the Golden hour timelines (media-arrange.ts). */
  readonly arranged?: boolean;
  /** What the consent check on this Mac hears instead of the line: voice.recordConsent is then a mismatch. */
  readonly heard?: string;
}

/** A consent recording is at most ten minutes (core's voiceConsentSchema; main's capture-table.ts). */
const MAX_CAPTURE_MS = 600_000;
const SAMPLE_RATE = 48_000;
const MAX_BYTES = (MAX_CAPTURE_MS / 1000) * SAMPLE_RATE * 2;

type CaptureState = 'recording' | 'stopped' | 'claimed';

interface Capture {
  readonly id: string;
  readonly consentId: VoiceConsentId;
  nextSeq: number;
  chunks: Uint8Array[];
  bytes: number;
  state: CaptureState;
  durationMs: number;
}

export interface StoppedCapture {
  readonly captureKey: string;
  readonly consentId: VoiceConsentId;
  readonly durationMs: number;
}

const notFound = (id: string) => err(NotFoundError({ entity: 'voiceCapture', id }));
const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw toRpcError(result.error);
  return result.value;
};

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256(chunks: readonly Uint8Array[], bytes: number): Promise<string> {
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  const digest = await crypto.subtle.digest('SHA-256', all);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createFakeVoiceCapture(deps: Phase3Deps, options: FakeVoiceCaptureOptions = {}) {
  if (options.arranged)
    for (const timeline of deps.make.timelines.all()) {
      const arranged = arrangeMedia(timeline);
      if (arranged !== timeline) deps.make.timelines.replace(timeline.projectId, arranged);
    }

  let permission: Permission = options.permission ?? 'granted';
  const captures = new Map<string, Capture>();
  const inState = (id: string, states: readonly CaptureState[]): Result<Capture> => {
    const capture = captures.get(id);
    return capture && states.includes(capture.state) ? ok(capture) : notFound(id);
  };

  const store = {
    permission(): Permission {
      // Asking happens only while the person hasn't decided (main's microphonePermission).
      if (permission === 'not-determined') permission = options.answer ?? 'granted';
      return permission;
    },
    start(consentId: VoiceConsentId): string {
      const id = newId<'VoiceCapture'>();
      captures.set(id, {
        id,
        consentId,
        nextSeq: 0,
        chunks: [],
        bytes: 0,
        state: 'recording',
        durationMs: 0,
      });
      return id;
    },
    append(input: {
      readonly captureId: string;
      readonly seq: number;
      readonly pcmBase64: string;
    }): Result<void> {
      const capture = inState(input.captureId, ['recording']);
      if (!capture.ok) return capture;
      if (input.seq !== capture.value.nextSeq)
        return err(
          ValidationError(
            { field: 'seq' },
            { detail: `chunk ${input.seq} arrived; ${capture.value.nextSeq} is next` },
          ),
        );
      const pcm = decode(input.pcmBase64);
      if (pcm.length % 2 !== 0)
        return err(
          ValidationError({ field: 'pcmBase64' }, { detail: 'PCM is 16-bit: an even number of bytes' }),
        );
      if (capture.value.bytes + pcm.length > MAX_BYTES)
        return err(
          ValidationError({ field: 'pcmBase64' }, { detail: 'a consent recording is at most 10 minutes' }),
        );
      capture.value.nextSeq += 1;
      capture.value.bytes += pcm.length;
      capture.value.chunks.push(pcm);
      return ok(undefined);
    },
    async stop(
      captureId: string,
    ): Promise<Result<{ captureKey: string; durationMs: number; sha256: string }>> {
      const capture = inState(captureId, ['recording']);
      if (!capture.ok) return capture;
      capture.value.state = 'stopped';
      capture.value.durationMs = Math.round((capture.value.bytes / 2 / SAMPLE_RATE) * 1000);
      return ok({
        captureKey: captureId,
        durationMs: capture.value.durationMs,
        sha256: await sha256(capture.value.chunks, capture.value.bytes),
      });
    },
    cancel(captureId: string): Result<void> {
      const capture = inState(captureId, ['recording', 'stopped']);
      if (!capture.ok) return capture;
      captures.delete(captureId);
      return ok(undefined);
    },
    /** A stopped capture, once (voiceCaptureFilesContract.claim's part the consent commands need). */
    claim(captureKey: string): Result<StoppedCapture> {
      const capture = inState(captureKey, ['stopped']);
      if (!capture.ok) return capture;
      capture.value.state = 'claimed';
      capture.value.chunks = [];
      return ok({ captureKey, consentId: capture.value.consentId, durationMs: capture.value.durationMs });
    },
    /** For tests: each capture's state and how much it holds. */
    list: () =>
      [...captures.values()].map(({ id, state, nextSeq, bytes }) => ({ id, state, chunks: nextSeq, bytes })),
  };

  const os = implementContract(appContract.voiceCapture);
  const router = os.router({
    permission: os.permission.handler(() => store.permission()),
    start: os.start.handler(({ input }) => ({
      captureId: store.start('consentId' in input ? input.consentId : newId<'VoiceConsent'>()),
    })),
    append: os.append.handler(({ input }) => unwrap(store.append(input))),
    stop: os.stop.handler(async ({ input }) => unwrap(await store.stop(input.captureId))),
    cancel: os.cancel.handler(({ input }) => unwrap(store.cancel(input.captureId))),
  });
  return { router, captures: store };
}

export type FakeVoiceCapture = ReturnType<typeof createFakeVoiceCapture>;
