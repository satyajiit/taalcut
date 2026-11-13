// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app's CardVoiceCapture (P3-B6): the voice consent card records through this, over main's voiceCapture
 * (backend/contract.ts) and the window's microphone. The kit stays IPC-free; the chat's card actions hand it to
 * the cards as `voiceCapture`.
 */
import { callRpc } from '@taalcut/core';
import type { CardVoiceCapture } from '@taalcut/ui';
import { useMemo } from 'react';
import { useSoundActivity } from '../sounds/sound-activity-context';
import { useBackend, type Backend } from '../../backend/backend';
import { openBrowserMicrophone } from './microphone';
import { createVoiceRecorder, type OpenMicrophone, type VoiceCaptureApi } from './voice-recorder';

/** main's voiceCapture procedures as results. */
export function voiceCaptureApi(backend: Pick<Backend, 'voiceCapture'>): VoiceCaptureApi {
  const capture = backend.voiceCapture;
  return {
    permission: () => callRpc(capture.permission()),
    start: (input) => callRpc(capture.start(input)),
    append: (input) => callRpc(capture.append(input)),
    stop: (input) => callRpc(capture.stop(input)),
    cancel: (input) => callRpc(capture.cancel(input)),
  };
}

export function useVoiceCapture(openMicrophone: OpenMicrophone = openBrowserMicrophone): CardVoiceCapture {
  const backend = useBackend();
  const activity = useSoundActivity();
  return useMemo(
    () => createVoiceRecorder({ capture: voiceCaptureApi(backend), openMicrophone, activity }),
    [backend, openMicrophone, activity],
  );
}
