// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX1-IMPORT: Chrome's reduced User-Agent sends "K" where the phone's model would be, and transfer's describeDevice
 * read it as the model, so every Chrome phone's Wi-Fi import source was named "K" (transfer now names it "Android
 * phone"). A Wi-Fi import source still called exactly that, with that device label, is renamed the same way: a source
 * the person renamed, any other source and every other column stay as they are.
 *
 * Forward-only: down leaves the name, since the old one was a parsing mistake and nothing records which rows had it.
 */
import type { Migration } from './types';

const up = `
UPDATE sources SET display_name = 'Android phone', device_label = 'Android phone'
  WHERE kind = 'wifi_import' AND display_name = 'K' AND device_label = 'K';
`;

const down = `-- Forward-only: the name "K" was a parsing mistake; nothing to restore.`;

export const reducedUaSourceNames: Migration = { version: 28, name: 'reduced_ua_source_names', up, down };
