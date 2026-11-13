// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';

/**
 * Info.plist key so the Local Network alert explains itself (Apple TN3179).
 * The English string is the development-language value; Lingui extracts it
 * for the other catalogues.
 */
export const LOCAL_NETWORK_USAGE: MessageDescriptor = /*i18n*/ {
  id: 'macos.localNetworkUsage',
  message:
    'Taalcut checks that this Mac can be reached on your Wi-Fi so your phone can send videos. Phones can still send if you turn this off.',
};

export const NS_LOCAL_NETWORK_USAGE_DESCRIPTION = LOCAL_NETWORK_USAGE.message ?? '';

/**
 * The read-only imports use PhotoKit or a connected iPhone/iPad. The prompt is shown only after Connect.
 */
export const PHOTO_LIBRARY_USAGE: MessageDescriptor = /*i18n*/ {
  id: 'macos.photoLibraryUsage',
  message:
    'Taalcut reads the photos and videos you choose from Apple Photos or a connected iPhone or iPad. Your originals stay unchanged.',
};

export const NS_PHOTO_LIBRARY_USAGE_DESCRIPTION = PHOTO_LIBRARY_USAGE.message ?? '';
