// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The one order of device items by creation date, used by the picker (newest first), a run
 * (oldest first) and the bridges that sort their own listings. Items without a date go last
 * either way; ties fall back to the item id so the order is stable.
 */
import type { DeviceItem } from './bridge';

function byCreated(direction: 1 | -1): (a: DeviceItem, b: DeviceItem) => number {
  return (a, b) => {
    if (a.createdAt !== b.createdAt) {
      if (a.createdAt === null) return 1;
      if (b.createdAt === null) return -1;
      return direction * (a.createdAt - b.createdAt);
    }
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  };
}

export const oldestFirst = byCreated(1);
export const newestFirst = byCreated(-1);
