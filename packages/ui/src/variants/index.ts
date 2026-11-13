// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Phase 3 (ui-make): this area's public surface, re-exported by the package's index.ts. */
export { newBatchId } from './batch-id';
export { HOOK_WINDOW, stepClock, useHookClock, type HookClock, type HookMode } from './hook-clock';
export {
  useVariantPlayer,
  VariantPlayerProvider,
  type RenderVariantPlayer,
  type VariantPlayerProps,
} from './variant-player';
export { VariantTile, type CompareVariant, type VariantTileProps } from './variant-tile';
export { differenceWords, shortLine, variantLabel } from './variant-words';
export { VariantsCompareView, type VariantsCompareViewProps } from './variants-compare-view';
