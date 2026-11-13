// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The voice consent card's microphone (P3-B6, core C-12): main's voiceCapture keeps the recording, the window keeps
 * nothing. Start opens a capture in main, then the microphone; every quarter second of samples goes to main as the
 * next numbered chunk, one after another, so main gets them in order. Stop sends what is left and finishes the
 * file (its key is what voice.recordConsent names); Cancel drops it. A chunk main refuses, or a microphone that
 * goes away, ends the recording and says why.
 */
import {
  createSerialQueue,
  err,
  ok,
  toTaalcutError,
  type Result,
  type TaalcutError,
  type VoiceConsentId,
  type ProjectId,
  ValidationError,
} from '@taalcut/core';
import type { CardVoiceRecording, MicrophonePermission } from '@taalcut/ui';
import { NO_SOUND_ACTIVITY, type SoundActivity } from '../sounds/sound-activity';
import { CAPTURE_SAMPLE_RATE, CHUNK_SAMPLES, createChunker, levelOf, pcmBase64 } from './pcm';

/** main's voiceCapture as results (backend/contract.ts's `voiceCapture`). */
export interface VoiceCaptureApi {
  permission(): Promise<Result<MicrophonePermission>>;
  start(
    input:
      | {
          readonly consentId: VoiceConsentId;
          readonly sampleRate: typeof CAPTURE_SAMPLE_RATE;
        }
      | {
          readonly projectId: ProjectId;
          readonly purpose: 'narration';
          readonly sampleRate: typeof CAPTURE_SAMPLE_RATE;
        },
  ): Promise<Result<{ readonly captureId: string }>>;
  append(input: {
    readonly captureId: string;
    readonly seq: number;
    readonly pcmBase64: string;
  }): Promise<Result<unknown>>;
  stop(input: {
    readonly captureId: string;
  }): Promise<Result<{ readonly captureKey: string; readonly durationMs: number }>>;
  cancel(input: { readonly captureId: string }): Promise<Result<unknown>>;
}

/** The microphone, open: samples arrive through the callback given to OpenMicrophone. */
export interface MicrophoneInput {
  close(): Promise<void>;
}

/** Opens the microphone at 48 kHz mono; `onSamples` gets each block, `onEnded` if the device goes away. */
export type OpenMicrophone = (
  onSamples: (samples: Float32Array) => void,
  onEnded: () => void,
) => Promise<Result<MicrophoneInput>>;

export interface LocalVoiceRecorder {
  permission(): Promise<Result<MicrophonePermission>>;
  start(input: {
    consentId?: VoiceConsentId;
    projectId?: ProjectId;
    maxSamples?: number;
    onLimit?(): void;
    onLevel(level: number): void;
    onFailed(error: TaalcutError): void;
  }): Promise<Result<CardVoiceRecording>>;
}

export function createVoiceRecorder(deps: {
  readonly capture: VoiceCaptureApi;
  readonly openMicrophone: OpenMicrophone;
  readonly onSamples?: (samples: Float32Array) => void;
  readonly activity?: SoundActivity;
}): LocalVoiceRecorder {
  const { capture } = deps;
  const activity = deps.activity ?? NO_SOUND_ACTIVITY;
  return {
    async permission() {
      const release = activity.acquire('recording');
      try {
        return await capture.permission();
      } finally {
        release();
      }
    },
    async start({ consentId, projectId, maxSamples = Infinity, onLimit, onLevel, onFailed }) {
      if (!consentId && !projectId) return err(ValidationError({ field: 'recording' }));
      const release = activity.acquire('recording');
      let recordingStarted = false;
      try {
        const started = await capture.start(
          projectId
            ? { purpose: 'narration', projectId, sampleRate: CAPTURE_SAMPLE_RATE }
            : { consentId: consentId!, sampleRate: CAPTURE_SAMPLE_RATE },
        );
        if (!started.ok) return started;
        const { captureId } = started.value;
        let seq = 0;
        let acceptedSamples = 0;
        let limitReached = false;
        /** One chunk at a time, so main gets them in order. */
        const sends = createSerialQueue();
        let failure: TaalcutError | null = null;
        /** Stop or Cancel was pressed: they report a failure themselves. */
        let ending = false;
        let over = false;
        let microphone: MicrophoneInput | null = null;
        let closing: Promise<void> | undefined;
        let opening = true;

        const close = async () => {
          over = true;
          // Opening can report a lost device before it returns its handle. The caller closes that late handle.
          if (opening) return;
          return (closing ??= (async () => {
            const open = microphone;
            microphone = null;
            try {
              await open?.close();
            } finally {
              release();
            }
          })());
        };
        const fail = (error: TaalcutError) => {
          if (failure) return;
          failure = error;
          if (ending) return;
          void close().then(() => capture.cancel({ captureId }));
          onFailed(error);
        };
        const send = async (chunk: { captureId: string; seq: number; pcmBase64: string }) => {
          if (failure) return;
          const sent = await capture.append(chunk);
          if (!sent.ok) fail(sent.error);
        };
        const chunker = createChunker(CHUNK_SAMPLES, (pcm) => {
          const chunk = { captureId, seq, pcmBase64: pcmBase64(pcm) };
          seq += 1;
          // A send that throws ends the recording like one main refused.
          void sends.run(() => send(chunk).catch((cause: unknown) => fail(toTaalcutError(cause))));
        });

        const opened = await deps.openMicrophone(
          (samples) => {
            if (over) return;
            const remaining = Math.max(0, maxSamples - acceptedSamples);
            const accepted = samples.length > remaining ? samples.subarray(0, remaining) : samples;
            acceptedSamples += accepted.length;
            deps.onSamples?.(accepted);
            onLevel(levelOf(accepted));
            chunker.push(accepted);
            if (!limitReached && acceptedSamples >= maxSamples) {
              limitReached = true;
              queueMicrotask(() => onLimit?.());
            }
          },
          () => fail(toTaalcutError(new Error('The microphone stopped while recording'))),
        );
        opening = false;
        if (!opened.ok) {
          await capture.cancel({ captureId });
          return opened;
        }
        if (over) {
          await opened.value.close();
          return err(failure ?? toTaalcutError(new Error('The microphone stopped while opening')));
        }
        microphone = opened.value;

        const recording: CardVoiceRecording = {
          async stop() {
            if (failure) return err(failure);
            ending = true;
            await close();
            chunker.flush();
            await sends.settled();
            if (failure) {
              await capture.cancel({ captureId });
              return err(failure);
            }
            const stopped = await capture.stop({ captureId });
            return stopped.ok
              ? ok({ captureKey: stopped.value.captureKey, durationMs: stopped.value.durationMs })
              : stopped;
          },
          async cancel() {
            // Already dropped when it failed on its own.
            if (failure && !ending) return ok(null);
            ending = true;
            await close();
            await sends.settled();
            return capture.cancel({ captureId });
          },
        };
        recordingStarted = true;
        return ok(recording);
      } finally {
        if (!recordingStarted) release();
      }
    },
  };
}
