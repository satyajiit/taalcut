// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Recording a voice consent (P3-B6). appContract.voiceCapture, owner main (it holds Electron's microphone
 * permission): the window records inside the consent card and streams PCM chunks; main writes
 * `<appData>/voice-consent/<captureId>.wav` and nothing but main and the consent store reads that folder.
 * voiceCaptureFilesContract is main's service for the agent process: the file's path, once, to move it into the
 * consent store. Captures not claimed within an hour are deleted.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { sha256Schema } from '../templates/template-parts';
import { ipc } from './contract';

export const MICROPHONE_PERMISSIONS = ['granted', 'denied', 'not-determined', 'restricted'] as const;
/** Base64 of at most 256 KiB of 16-bit mono PCM per chunk. */
export const VOICE_CAPTURE_CHUNK_BASE64 = 350_000;
/** Unclaimed captures are deleted after this long. */
export const VOICE_CAPTURE_TTL_MS = 60 * 60 * 1000;

const captureId = idSchema<'VoiceCapture'>();

export const voiceCaptureContract = {
  /** The macOS microphone permission; asks when not determined. */
  permission: ipc.output(z.enum(MICROPHONE_PERMISSIONS)),
  start: ipc
    .input(
      z.union([
        z.object({ consentId: idSchema<'VoiceConsent'>(), sampleRate: z.literal(48_000) }),
        z.object({
          purpose: z.literal('narration'),
          projectId: idSchema<'Project'>(),
          sampleRate: z.literal(48_000),
        }),
      ]),
    )
    .output(z.object({ captureId })),
  /** In order by `seq`. */
  append: ipc
    .input(
      z.object({
        captureId,
        seq: z.int().nonnegative(),
        pcmBase64: z.base64().max(VOICE_CAPTURE_CHUNK_BASE64),
      }),
    )
    .output(z.void()),
  /** Finishes the WAV; the key is what voice.recordConsent names. */
  stop: ipc
    .input(z.object({ captureId }))
    .output(z.object({ captureKey: captureId, durationMs: z.int().nonnegative(), sha256: sha256Schema })),
  cancel: ipc.input(z.object({ captureId })).output(z.void()),
};

export const voiceCaptureFilesContract = {
  claim: ipc
    .input(z.object({ captureKey: captureId, projectId: idSchema<'Project'>().optional() }))
    .output(z.object({ path: z.string().min(1).max(4096) })),
};
