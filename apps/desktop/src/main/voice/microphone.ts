// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The OS's microphone permission, behind a port so the capture router is unit-tested without Electron. The platform
 * picks the implementation (electron-microphone.ts): macOS's over systemPreferences, Linux's always granted.
 * `permission` asks only while the person hasn't decided; a denied or restricted microphone is reported as it is,
 * and System Settings is the way back.
 */
import type { MICROPHONE_PERMISSIONS } from '@taalcut/core';

export type MicrophonePermission = (typeof MICROPHONE_PERMISSIONS)[number];

export interface MicrophoneAccess {
  status(): MicrophonePermission;
  /** Shows the system prompt; true when access was granted. */
  ask(): Promise<boolean>;
}

export async function microphonePermission(microphone: MicrophoneAccess): Promise<MicrophonePermission> {
  const status = microphone.status();
  if (status !== 'not-determined') return status;
  await microphone.ask();
  return microphone.status();
}
