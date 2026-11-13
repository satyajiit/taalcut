// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The captures main knows of in this run, and the checks on each chunk: the next number in order, 16-bit PCM,
 * and at most ten minutes in all. A chunk that passes is counted at once, so a concurrent repeat is refused, and
 * its write is queued after the capture's previous one.
 */
import {
  createSerialQueue,
  err,
  NotFoundError,
  ok,
  ValidationError,
  type Result,
  type SerialQueue,
  type VoiceConsentId,
  type ProjectId,
} from '@taalcut/core';
import type { PcmFormat } from './wav-header';

/** A consent recording is at most ten minutes (core's voiceConsentSchema). */
export const MAX_CAPTURE_MS = 600_000;
export const CAPTURE_FORMAT: PcmFormat = { sampleRate: 48_000, channels: 1, bitsPerSample: 16 };
const MAX_DATA_BYTES =
  (MAX_CAPTURE_MS * CAPTURE_FORMAT.sampleRate * CAPTURE_FORMAT.channels * CAPTURE_FORMAT.bitsPerSample) /
  8 /
  1000;

export type CaptureState = 'recording' | 'stopped' | 'claimed';

export interface Capture {
  readonly id: string;
  readonly consentId: VoiceConsentId | null;
  readonly projectId: ProjectId | null;
  readonly startedAt: number;
  nextSeq: number;
  dataBytes: number;
  state: CaptureState;
  /** Appends run one after another; stop waits for the last. */
  readonly writes: SerialQueue;
  failure: Error | null;
}

export function newCapture(
  id: string,
  consentId: VoiceConsentId | null,
  startedAt: number,
  projectId: ProjectId | null = null,
): Capture {
  return {
    id,
    consentId,
    projectId,
    startedAt,
    nextSeq: 0,
    dataBytes: 0,
    state: 'recording',
    writes: createSerialQueue(),
    failure: null,
  };
}

export const captureNotFound = (id: string) => err(NotFoundError({ entity: 'voiceCapture', id }));

/** The capture with this id in one of `states`, else core.not_found. */
export function captureIn(
  captures: ReadonlyMap<string, Capture>,
  id: string,
  states: readonly CaptureState[],
): Result<Capture> {
  const capture = captures.get(id);
  return capture && states.includes(capture.state) ? ok(capture) : captureNotFound(id);
}

/** Checks a chunk against the capture and counts it; the bytes to append. */
export function acceptChunk(capture: Capture, seq: number, pcmBase64: string): Result<Buffer> {
  if (seq !== capture.nextSeq)
    return err(
      ValidationError({ field: 'seq' }, { detail: `chunk ${seq} arrived; ${capture.nextSeq} is next` }),
    );
  const pcm = Buffer.from(pcmBase64, 'base64');
  if (pcm.length % 2 !== 0)
    return err(ValidationError({ field: 'pcmBase64' }, { detail: 'PCM is 16-bit: an even number of bytes' }));
  if (capture.dataBytes + pcm.length > MAX_DATA_BYTES)
    return err(
      ValidationError({ field: 'pcmBase64' }, { detail: 'a consent recording is at most 10 minutes' }),
    );
  capture.nextSeq += 1;
  capture.dataBytes += pcm.length;
  return ok(pcm);
}

/** Runs `write` after the capture's previous write; a failure is kept on the capture, never thrown. */
export function queueWrite(capture: Capture, write: () => Promise<void>): Promise<void> {
  return capture.writes.run(async () => {
    try {
      await write();
    } catch (cause) {
      capture.failure = cause instanceof Error ? cause : new Error(String(cause));
    }
  });
}
