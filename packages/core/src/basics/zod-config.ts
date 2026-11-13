// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Zod without its JIT, in every process. The renderer runs under a strict
 * CSP (no eval), and zod probes for eval with `new Function` the first time
 * an object schema is built: the CSP reports that as a violation even though
 * zod catches it. Contract payloads are small, so the JIT buys nothing.
 *
 * Every module that builds an object schema imports this before zod, so it
 * runs before the first one, whatever a bundle includes. package.json lists
 * it under "sideEffects" so bundlers keep those imports.
 */
import { z } from 'zod';

z.config({ jitless: true });
