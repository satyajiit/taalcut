// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export {
  FoldFade,
  FoldLabel,
  FoldShift,
  SidebarPanel,
  useSidebarFold,
  type SidebarFold,
  type SidebarPanelProps,
} from './sidebar-fold';
export {
  currentFold,
  FOLD_LEAD,
  foldProgress,
  foldTo,
  onFold,
  settleFold,
  type Fold,
} from './fold-clock';
export { FoldFlip, type FoldFlipProps } from './fold-flip';
export {
  ActivationTick,
  createIndicatorStore,
  CurrentIndicator,
  HoverIndicator,
  IndicatorStoreProvider,
  resetIndicatorStore,
  type IndicatorStore,
} from './current-indicator';
export { RailTooltip, RailTooltipGroup, type RailTooltipProps } from './rail-tooltip';
