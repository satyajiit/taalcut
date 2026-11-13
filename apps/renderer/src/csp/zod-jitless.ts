// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { config } from 'zod';

/**
 * Zod compiles fast parsers with `new Function`, after probing whether eval
 * is allowed. Under script-src 'self' the probe fails quietly but still
 * reports a CSP violation. Jitless mode skips both. Core's schemas (cards,
 * events) share this zod instance, so this covers them. Import it first.
 */
config({ jitless: true });
