// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** brandAssets (P3-V10): the brand layout the layer drew, checked against the safe rect and the files present. */
import { brandAssetsCheck } from '../checks/brand';
import { skipped } from '../result';
import type { QaCheckModule } from './module';

export const brandQaModule: QaCheckModule = {
  ids: ['brandAssets'],
  probeFrames: () => [],
  async run({ run, facts }, wanted) {
    if (!wanted.has('brandAssets')) return [];
    const brand = facts.brand;
    if (!brand) return [skipped('brandAssets')];
    return [
      brandAssetsCheck({
        style: brand.style,
        bumpers: brand.bumpers,
        canvas: { width: run.plan.width, height: run.plan.height, safe: brand.safe },
        durationFrames: run.plan.durationFrames,
        assetsPresent: brand.assetsPresent,
      }),
    ];
  },
};
