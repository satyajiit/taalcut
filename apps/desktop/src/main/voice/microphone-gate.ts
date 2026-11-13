// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether the window may have the microphone right now (security review SV-6): only while main has a consent
 * recording under way, which the consent card starts (voiceCapture.start) before it asks for the microphone.
 * The session's permission handlers are set before the container exists, so the gate starts closed and main
 * binds it to the capture store once composed.
 */
export interface MicrophoneGate {
  isOpen(): boolean;
  bind(source: { isRecording(): boolean }): void;
}

export function createMicrophoneGate(): MicrophoneGate {
  let source: { isRecording(): boolean } | null = null;
  return {
    isOpen: () => source?.isRecording() ?? false,
    bind(next) {
      source = next;
    },
  };
}
