// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The file a preview or a still plays for an asset: its proxy first when asked (a video's), else its original. */
import type { AssetId } from '@taalcut/core';
import type { AssetFiles } from '../ports';

export async function playableFile(
  assets: AssetFiles,
  assetId: AssetId,
  proxyFirst: boolean,
): Promise<string | null> {
  if (proxyFirst) {
    const proxy = await assets.proxy(assetId);
    if (proxy.ok && proxy.value) return proxy.value;
  }
  const original = await assets.original(assetId);
  return original.ok && original.value ? original.value.path : null;
}
