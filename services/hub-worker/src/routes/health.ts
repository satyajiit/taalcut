// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { json } from '../http/respond';
import { type Route } from './route';

/** GET /v0/health. It answers only once the configuration checks, so a deploy smoke test sees a missing secret. */
export const healthRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: /^\/v0\/health$/,
    handle: async () => json({ ok: true, formatVersion: 0 }, 200),
  },
];
