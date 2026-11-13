// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineError } from '@taalcut/core';

export const NoNetwork = defineError('transfer.no_network');
export const BindFailed = defineError('transfer.bind_failed', { retryable: true });
export const SessionClosed = defineError('transfer.session_closed');
export const PairingFailed = defineError('transfer.pairing_failed');
export const NotMedia = defineError('transfer.not_media');
export const TooLarge = defineError('transfer.too_large');
export const DiskFull = defineError('transfer.disk_full');
export const ImportFailed = defineError('transfer.import_failed', { retryable: true });
