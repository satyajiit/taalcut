// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Consent recordings as main writes them (P3-B6, core C-12): the consent card records in the window and streams
 * 16-bit mono PCM at 48 kHz in numbered chunks; main appends them, in order, to `<captureId>.wav.part` under its
 * captures folder, writes the WAV header on stop and renames the file to `<captureId>.wav`. The agent process
 * claims a stopped capture's path once (voiceCaptureFilesContract), to check it and move it into the consent
 * store; a window never learns the path. Captures not claimed within VOICE_CAPTURE_TTL_MS, and unfinished ones,
 * are deleted: at start-up and whenever a recording starts. Files are 0600 in a 0700 folder (capture-files.ts);
 * the chunk checks are capture-table.ts', the sweep capture-sweep.ts'.
 */
import {
  err,
  newId,
  ok,
  toTaalcutError,
  ValidationError,
  VOICE_CAPTURE_TTL_MS,
  type AsyncResult,
  type Clock,
  type VoiceConsentId,
  type ProjectId,
} from '@taalcut/core';
import { createCaptureFiles } from './capture-files';
import { sweepCaptures } from './capture-sweep';
import {
  acceptChunk,
  CAPTURE_FORMAT,
  captureIn,
  MAX_CAPTURE_MS,
  newCapture,
  queueWrite,
  type Capture,
} from './capture-table';
import { pcmDurationMs, wavHeader } from './wav-header';

export { MAX_CAPTURE_MS } from './capture-table';

export interface StoppedCapture {
  readonly captureKey: string;
  readonly durationMs: number;
  readonly sha256: string;
}

export interface VoiceCaptureStore {
  start(input: {
    readonly consentId?: VoiceConsentId;
    readonly projectId?: ProjectId;
    readonly sampleRate: number;
  }): AsyncResult<string>;
  append(input: {
    readonly captureId: string;
    readonly seq: number;
    readonly pcmBase64: string;
  }): AsyncResult<void>;
  stop(captureId: string): AsyncResult<StoppedCapture>;
  cancel(captureId: string): AsyncResult<void>;
  /** A stopped capture's path, once. */
  claim(captureKey: string, projectId?: ProjectId): AsyncResult<{ readonly path: string }>;
  /** Deletes what has outlived the TTL: unclaimed captures, unfinished ones and leftovers of an earlier run. */
  sweep(): AsyncResult<void>;
  /**
   * Whether a consent recording is under way: started, not yet stopped or cancelled, and younger than the
   * longest recording allowed (a window that went away mid-recording stops counting then). Main grants the
   * microphone only while this holds (security review SV-6).
   */
  isRecording(): boolean;
}

export interface VoiceCaptureStoreDeps {
  /** Main's captures folder, e.g. `<userData>/voice-consent/captures`. */
  readonly dir: string;
  readonly clock: Clock;
  readonly ids?: () => string;
  readonly log?: (line: string) => void;
}

/** Node's errors as error values. */
async function attempt<T>(work: () => Promise<T>): AsyncResult<T> {
  try {
    return ok(await work());
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}

const asError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

export function createVoiceCaptureStore(deps: VoiceCaptureStoreDeps): VoiceCaptureStore {
  const captures = new Map<string, Capture>();
  const files = createCaptureFiles(deps.dir);
  const ids = deps.ids ?? (() => newId<'VoiceCapture'>());
  const log = deps.log ?? ((line: string) => console.warn(line));
  const sweep = () => sweepCaptures(captures, files, deps.clock.now() - VOICE_CAPTURE_TTL_MS);
  const sweepLogged = () =>
    sweep().catch((cause: unknown) => log(`[voice-capture] sweep failed: ${toTaalcutError(cause).code}`));

  /** The folder made private and the leftovers swept, once; a failure is every start's error. */
  const ready: Promise<Error | null> = files
    .prepare()
    .then(sweepLogged)
    .then(() => null, asError);
  const whenReady = async <T>(work: () => Promise<T>): AsyncResult<T> => {
    const unready = await ready;
    return unready ? err(toTaalcutError(unready)) : attempt(work);
  };

  async function finish(capture: Capture): AsyncResult<StoppedCapture> {
    const finished = await attempt(() =>
      files.finish(capture.id, wavHeader(CAPTURE_FORMAT, capture.dataBytes)),
    );
    if (!finished.ok) return finished;
    capture.state = 'stopped';
    const sha256 = await attempt(() => files.sha256(finished.value));
    if (!sha256.ok) return sha256;
    return ok({
      captureKey: capture.id,
      durationMs: pcmDurationMs(CAPTURE_FORMAT, capture.dataBytes),
      sha256: sha256.value,
    });
  }

  return {
    async start({ consentId, projectId, sampleRate }) {
      if (sampleRate !== CAPTURE_FORMAT.sampleRate)
        return err(ValidationError({ field: 'sampleRate' }, { detail: 'captures are 48 kHz' }));
      return whenReady(async () => {
        await sweepLogged();
        const id = ids();
        await files.begin(id);
        captures.set(id, newCapture(id, consentId ?? null, deps.clock.now(), projectId ?? null));
        return id;
      });
    },

    async append({ captureId, seq, pcmBase64 }) {
      const capture = captureIn(captures, captureId, ['recording']);
      if (!capture.ok) return capture;
      const pcm = acceptChunk(capture.value, seq, pcmBase64);
      if (!pcm.ok) return pcm;
      await queueWrite(capture.value, () => files.append(captureId, pcm.value));
      return capture.value.failure ? err(toTaalcutError(capture.value.failure)) : ok(undefined);
    },

    async stop(captureId) {
      const capture = captureIn(captures, captureId, ['recording']);
      if (!capture.ok) return capture;
      await capture.value.writes.settled();
      const failure = capture.value.failure;
      if (!failure) return finish(capture.value);
      captures.delete(captureId);
      await files.remove(captureId);
      return err(toTaalcutError(failure));
    },

    async cancel(captureId) {
      const capture = captureIn(captures, captureId, ['recording', 'stopped']);
      if (!capture.ok) return capture;
      captures.delete(captureId);
      await capture.value.writes.settled();
      return attempt(() => files.remove(captureId));
    },

    async claim(captureKey, projectId) {
      const capture = captureIn(captures, captureKey, projectId ? ['stopped', 'claimed'] : ['stopped']);
      if (!capture.ok) return capture;
      if ((capture.value.projectId ?? undefined) !== projectId)
        return err(ValidationError({ field: 'projectId' }));
      capture.value.state = 'claimed';
      return ok({ path: files.finishedPath(captureKey) });
    },

    sweep: () => whenReady(sweep),

    isRecording() {
      const since = deps.clock.now() - MAX_CAPTURE_MS;
      for (const capture of captures.values()) {
        if (capture.state === 'recording' && capture.startedAt >= since) return true;
      }
      return false;
    },
  };
}
