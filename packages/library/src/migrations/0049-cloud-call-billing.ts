// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Migration } from './types';

/** Preserve unknown billing for old rows; zero dollars alone does not imply a subscription. */
export const cloudCallBilling: Migration = {
  version: 49,
  name: 'cloud_call_billing',
  up: `ALTER TABLE cloud_calls ADD COLUMN billing TEXT CHECK (billing IN ('apiKey', 'subscription'));`,
  down: `ALTER TABLE cloud_calls DROP COLUMN billing;`,
};
