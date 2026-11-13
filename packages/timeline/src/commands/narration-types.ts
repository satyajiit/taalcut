// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AssetId, AsyncResult, ProjectId, RationalTime, VoiceCaptureId } from '@taalcut/core';

export interface NarrationAsset {
  readonly assetId: AssetId;
  readonly duration: RationalTime;
}
export type NarrationAssets = (
  input: { readonly assetId?: AssetId | undefined; readonly captureKey?: VoiceCaptureId | undefined },
  projectId: ProjectId,
) => AsyncResult<NarrationAsset>;
