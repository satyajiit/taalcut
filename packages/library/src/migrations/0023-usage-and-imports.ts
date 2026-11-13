// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * G8 and P3-B4/P3-B5. `cloud_calls` gains what a non-token API billed (CloudCallRecord.billed: characters,
 * seconds, images, credits; null for a token call), so Settings › Usage sums it by unit. `usb_imports` is the
 * import record a USB item leaves: which run, bridge, device and item it came from, its album and the hashes the
 * pull checked. One row per device item (a re-import of the same item points it at the asset it became), dropped
 * with the asset.
 */
import type { Migration } from './types';

const up = `
ALTER TABLE cloud_calls ADD COLUMN billed_unit TEXT
  CHECK (billed_unit IS NULL OR billed_unit IN ('token', 'character', 'second', 'image', 'credit'));
ALTER TABLE cloud_calls ADD COLUMN billed_quantity REAL
  CHECK (billed_quantity IS NULL OR billed_quantity >= 0);

CREATE TABLE usb_imports (
  device_key TEXT NOT NULL CHECK (length(device_key) BETWEEN 1 AND 128),
  item_key TEXT NOT NULL CHECK (length(item_key) BETWEEN 1 AND 128),
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  bridge TEXT NOT NULL CHECK (bridge IN ('image-capture', 'adb', 'mtp')),
  device_created_at INTEGER,
  album TEXT CHECK (album IS NULL OR length(album) <= 120),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  source_sha256 TEXT CHECK (source_sha256 IS NULL OR length(source_sha256) = 64),
  imported_at INTEGER NOT NULL,
  PRIMARY KEY (device_key, item_key)
) STRICT;
CREATE INDEX usb_imports_asset_idx ON usb_imports(asset_id);
`;

const down = `
DROP TABLE usb_imports;
ALTER TABLE cloud_calls DROP COLUMN billed_quantity;
ALTER TABLE cloud_calls DROP COLUMN billed_unit;
`;

export const usageAndImports: Migration = { version: 23, name: 'usage_and_imports', up, down };
