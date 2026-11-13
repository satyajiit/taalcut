// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Placeholder classification (transfer SPEC, "iCloud placeholders").
 * Pure: the run applies retries and decides what is stored.
 */
export interface IcloudFacts {
  readonly iCloudPhotos: boolean;
  readonly availability: 'local' | 'cloud-only' | 'unknown';
  /** Bridge failure detail (`devices.item_empty`, `devices.download_failed`). Null when bytes were written. */
  readonly detail: string | null;
  /** Fewer bytes than listed, or a JPEG/H.264 body for a HEIC/HEVC name. */
  readonly shortOriginal: boolean;
  /** How many times `devices.download_failed` has been seen, including this attempt. */
  readonly downloadFailedCount: number;
}

/**
 * `in-icloud` when the listing says cloud-only, or iCloud Photos is on and a
 * pull signal agrees. Anything else is `no` (a normal failure or a real file).
 */
export function classifyIcloud(facts: IcloudFacts): 'in-icloud' | 'no' {
  if (facts.availability === 'cloud-only') return 'in-icloud';
  if (!facts.iCloudPhotos) return 'no';
  if (facts.detail === 'devices.item_empty') return 'in-icloud';
  if (facts.detail === 'devices.download_failed' && facts.downloadFailedCount >= 2) return 'in-icloud';
  if (facts.shortOriginal) return 'in-icloud';
  return 'no';
}
