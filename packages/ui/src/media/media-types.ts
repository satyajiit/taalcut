// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The media cards' value types that CardActions and CardData name (P3-B6, P3-V13): the microphone, a play point. */
import type { MICROPHONE_PERMISSIONS, Result, TaalcutError, VoiceConsentId } from '@taalcut/core';

export type MicrophonePermission = (typeof MICROPHONE_PERMISSIONS)[number];

/** P3-B6: a recording in progress; main keeps the file, the window keeps nothing. */
export interface CardVoiceRecording {
  /** Finishes the WAV; the key voice.recordConsent names. */
  stop(): Promise<Result<{ readonly captureKey: string; readonly durationMs: number }>>;
  /** Drops the recording (main deletes the file). */
  cancel(): Promise<Result<unknown>>;
}

/** P3-B6: the microphone for a voice consent, over main's voiceCapture (the renderer records; the kit shows it). */
export interface CardVoiceCapture {
  /** The macOS microphone permission; asks when it isn't decided yet. */
  permission(): Promise<Result<MicrophonePermission>>;
  /**
   * Records for a consent: 16-bit mono PCM at 48 kHz streamed to main in order. `onLevel` gets the input level
   * (0 to 1) about twenty times a second; `onFailed` when the recording stops on its own (the microphone went
   * away, main refused a chunk).
   */
  start(input: {
    readonly consentId: VoiceConsentId;
    readonly onLevel: (level: number) => void;
    readonly onFailed: (error: TaalcutError) => void;
  }): Promise<Result<CardVoiceRecording>>;
}

/** Where a card's preview starts playing: a new `key` plays again from `frame`. */
export interface PreviewPlayFrom {
  readonly frame: number;
  readonly key: number;
}
