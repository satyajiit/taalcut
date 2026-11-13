// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { DeviceAccessState, DeviceView } from '@taalcut/core';

/** What the phone is waiting for, in words, with what to do (docs/onboarding.md 7.3). */
export const ACCESS_WORDS: Record<Exclude<DeviceAccessState, 'ready'>, MessageDescriptor> = {
  opening: msg`Opening the phone…`,
  locked: msg`Unlock your iPhone to carry on.`,
  'not-trusted': msg`On your iPhone, tap Trust, then enter your passcode.`,
  'needs-file-transfer': msg`On your phone, tap the USB notification and choose File transfer.`,
  'needs-debugging-allow': msg`On your phone, tap Allow when it asks about USB debugging.`,
  busy: msg`Another app is using the phone. Close it, then try again.`,
  unsupported: msg`Taalcut can’t read this phone over a cable. Use Wi-Fi instead.`,
};

/**
 * Platform-aware access prompt: an Android phone that exposes no MTP storage while locked or set
 * to Charging-only reports `locked`, so show the Android File transfer prompt instead of iPhone wording.
 */
export function accessWordsFor(device: Pick<DeviceView, 'platform' | 'access'>): MessageDescriptor {
  const access = device.access === 'ready' ? 'opening' : device.access;
  if (device.platform !== 'ios' && (access === 'locked' || access === 'not-trusted')) {
    return ACCESS_WORDS['needs-file-transfer'];
  }
  return ACCESS_WORDS[access];
}

/** Android storage can appear after unlocking without an access event, so retry re-reads the catalogue. */
export function canRetryDeviceAccess(device: Pick<DeviceView, 'platform' | 'access'>): boolean {
  if (device.access === 'busy') return true;
  return (
    device.platform !== 'ios' &&
    (device.access === 'locked' || device.access === 'not-trusted' || device.access === 'needs-file-transfer')
  );
}
