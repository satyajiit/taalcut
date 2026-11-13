// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The gate demo runs with the network off: any attempt to reach it fails the suite. */
import { disableNetwork } from '@taalcut/models';
import { afterAll } from 'vitest';

const guard = disableNetwork();
afterAll(() => {
  const blocked = [...guard.blocked];
  guard.restore();
  if (blocked.length > 0) throw new Error(`The gate demo tried to use the network: ${blocked.join(', ')}`);
});
