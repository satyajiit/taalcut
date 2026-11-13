// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's service for the lan process (P3-B5), on its services port only, never a window: the adb key lives in
 * main's keychain vault and is handed to the Android bridge when it connects.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ipc } from '../ipc/contract';

export const deviceKeysContract = {
  /** The adb RSA-2048 private key as PKCS#8 DER, base64; made on first use. */
  adbKey: ipc.output(z.object({ pkcs8: z.string().min(100).max(8000) })),
  forgetAdbKey: ipc.output(z.object({ forgotten: z.boolean() })),
};
