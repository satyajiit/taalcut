// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The microphone port over Electron's systemPreferences (macOS TCC; platform/darwin.ts). */
import type { SystemPreferencesPort } from '../../platform/types';
import type { MicrophoneAccess, MicrophonePermission } from './microphone';

type MediaAccess = Pick<SystemPreferencesPort, 'getMediaAccessStatus' | 'askForMediaAccess'>;

export function electronMicrophone(preferences: MediaAccess): MicrophoneAccess {
  return {
    status(): MicrophonePermission {
      const status = preferences.getMediaAccessStatus('microphone');
      // 'unknown' (an OS that can't say) is treated as not asked yet: asking is harmless.
      return status === 'unknown' ? 'not-determined' : status;
    },
    ask: () => preferences.askForMediaAccess('microphone'),
  };
}

/**
 * Linux: no OS-level microphone permission to ask for. Access is the session's (PipeWire or PulseAudio), and the
 * app's own gate (microphone-gate.ts) still refuses the page until a consent recording is under way.
 */
export const grantedMicrophone: MicrophoneAccess = {
  status: () => 'granted',
  ask: () => Promise.resolve(true),
};
