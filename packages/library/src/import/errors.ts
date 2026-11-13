// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Errors of the Wi-Fi hand-off (P2-L3). Each code's i18n key is `errors.<code>`. */
import { defineError } from '@taalcut/core';

/** The originals folder's drive isn't plugged in. `name`: the drive's name, for the message (never a path). */
export const OriginalsOffline = defineError<{ readonly name: string }>('library.originals_offline', {
  retryable: true,
});
