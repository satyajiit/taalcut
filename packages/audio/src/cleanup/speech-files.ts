// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where an analysis is cached: derived JSON in the media cache, keyed by the asset's content hash and the cleanup
 * config, so a new recipe or config writes a new file and a stale one is simply not found
 * (`speech/<hh>/<hash>.cfg<config>.v<recipe>.json`, core's DERIVED_KEY_PATTERN).
 */
import { createHash } from 'node:crypto';
import type { AsyncResult } from '@taalcut/core';
import { CLEANUP_AUDIO_CONFIG } from './config';

/** Reads and writes derived JSON by key (media's cache in the app). */
export interface DerivedJson {
  read(key: string, signal?: AbortSignal): AsyncResult<unknown>;
  write(key: string, json: unknown, signal?: AbortSignal): AsyncResult<void>;
}

const HASH = /^[0-9a-f]{64}$/;

export function speechKey(contentHash: string): string {
  const hash = HASH.test(contentHash) ? contentHash : createHash('sha256').update(contentHash).digest('hex');
  return `speech/${hash.slice(0, 2)}/${hash}.cfg${CLEANUP_AUDIO_CONFIG.configVersion}.v${CLEANUP_AUDIO_CONFIG.recipe}.json`;
}
