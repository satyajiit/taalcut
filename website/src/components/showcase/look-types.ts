// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { LucideIcon } from 'lucide-react';
import type { KaatuPose } from '#components/kaatu/kaatu';
import type { AppArea } from '#components/ui/app-window';
import type { StickerField } from '#components/ui/sticker';

/*
 * The shape of a feature's look, apart from look.tsx so each feature's meta.tsx can type its LOOK without importing
 * look.tsx, which imports every meta.tsx (no cycle).
 */

export type FeatureJob = 'beat' | 'you' | 'ink' | 'ai';
export type LookIcon = LucideIcon | 'ai';

export interface FeatureLook {
  readonly icon: LookIcon;
  readonly job: FeatureJob;
  readonly area: AppArea;
  readonly pose: KaatuPose;
  readonly stickers: readonly { readonly field: StickerField; readonly icon: LookIcon }[];
}
