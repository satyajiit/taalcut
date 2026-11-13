// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';

/**
 * Info.plist key so the microphone alert explains itself: only the voice consent card records, and the
 * recording stays on this Mac until the person makes a clone of their own voice. The English string is the
 * development-language value; Lingui extracts it for the other catalogues.
 */
export const MICROPHONE_USAGE: MessageDescriptor = /*i18n*/ {
  id: 'macos.microphoneUsage',
  message:
    'Taalcut records your voice only when you read the consent line to make a voice of your own. The recording stays on this Mac until you create that voice.',
};

export const NS_MICROPHONE_USAGE_DESCRIPTION = MICROPHONE_USAGE.message ?? '';
