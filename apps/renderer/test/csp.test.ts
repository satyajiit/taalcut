// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { APP_CSP } from '@taalcut/core';
import { expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../csp';

it('vite preview sends the same CSP as the desktop app', () => {
  expect(CONTENT_SECURITY_POLICY).toBe(APP_CSP);
});
