// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { hex } from '../encoding/bytes';

/** HMAC-SHA-256(INSTALL_ID_SALT, installKey) as hex. The raw key is never stored or logged. */
export async function installHash(salt: string, installKey: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(installKey));
  return hex(new Uint8Array(signature));
}
