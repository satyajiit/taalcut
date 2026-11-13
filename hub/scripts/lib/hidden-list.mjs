// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';

/** moderation/hidden.json; a missing file is an empty list, anything else unreadable is an error. */
export function readHidden(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('hidden.json must be an array');
  return parsed;
}

export function hiddenIds(list) {
  const ids = new Set();
  for (const item of list) {
    if (item && typeof item === 'object' && typeof item.hubId === 'string') ids.add(item.hubId);
  }
  return ids;
}

/** Hide appends once. Restore removes every row for that id. Both are idempotent. */
export function applyHidden(list, command) {
  if (command.action === 'restore') return list.filter((item) => !item || item.hubId !== command.hubId);
  if (list.some((item) => item && item.hubId === command.hubId)) return list;
  return [...list, { hubId: command.hubId, reason: command.reason, issue: command.issue, at: command.at }];
}
