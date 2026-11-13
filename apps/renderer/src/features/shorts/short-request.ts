// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AssetId } from '@taalcut/core';

export type ShortSource =
  | { kind: 'asset'; assetId: AssetId; name: string }
  | { kind: 'url'; url: string }
  | { kind: 'file'; path: string };

export function shortDuration(value: string): number | null {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 15 && seconds <= 179 ? seconds : null;
}

export function youtubeSource(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** A structured source keeps similarly named files distinct in the agent's first message. */
export function shortSourceReference(source: ShortSource): string {
  if (source.kind === 'asset') return JSON.stringify({ assetId: source.assetId, name: source.name });
  if (source.kind === 'file') return JSON.stringify({ path: source.path });
  return JSON.stringify({ sourceUrl: source.url });
}
