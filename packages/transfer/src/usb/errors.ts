// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineError } from '@taalcut/core';

export const DeviceGone = defineError('transfer.device_gone', { retryable: true });
export const DeviceLocked = defineError('transfer.device_locked');
export const DeviceBusy = defineError('transfer.device_busy');
export const DeviceUnsupported = defineError('transfer.device_unsupported');
export const TooManyItems = defineError('transfer.too_many_items');
export const RunInProgress = defineError('transfer.run_in_progress');
export const ShortRead = defineError('transfer.short_read', { retryable: true });
export const HashMismatch = defineError('transfer.hash_mismatch', { retryable: true });
/** `detail` is the bridge's code only. Never a path or a serial. */
export const BridgeFailed = defineError('transfer.bridge_failed', { retryable: true });
