// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Phase 3 (ui-make): this area's public surface, re-exported by the package's index.ts. */
export { GapFixPopover, type GapFixPopoverProps } from './gap-fix-popover';
export { GapFixView, useSettledGaps, type GapFixViewProps } from './gap-fix-view';
export type {
  GapFixChoice,
  GapFixHandlers,
  GapFixItem,
  GapFixOptionView,
  GapFixPick,
  GapFixReason,
  StockQuery,
} from './gap-types';
export { LicenceChip } from './licence-chip';
export { StockResultTile, type StockResultTileProps, type StockTileState } from './stock-result-tile';
