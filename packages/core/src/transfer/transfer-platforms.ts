// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The phone platforms import knows (Wi-Fi and USB), kept apart so both contracts read it without a cycle. */
export const TRANSFER_PLATFORMS = ['ios', 'android', 'other'] as const;
export type TransferPlatform = (typeof TRANSFER_PLATFORMS)[number];
