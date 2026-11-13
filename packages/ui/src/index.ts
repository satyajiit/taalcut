// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/ui: shadcn/ui kit restyled with Taalcut tokens, the theme engine and
 * the smart-card kit, skeletons, global loader and warning card. May import
 * types (only) from core. See SPEC.md.
 *
 * This file is the package's only public entry point for code. Two asset entries
 * exist for build tooling: '@taalcut/ui/styles.css' (imported by the app's
 * stylesheet) and '@taalcut/ui/web-boot.js' (served as /theme-boot.js).
 *
 * Each area has its own entry file (`<area>/index.ts`), re-exported whole here,
 * so an area's public names are listed beside its code.
 */
export { cn } from './lib/cn';
export { AnimatePresence, motion, useReducedMotion } from 'motion/react';
export { moneyFieldText, moneyShape, parseMoneyText, type MoneyShape } from './lib/money';
export { createFormatters, listOf, useFormatters, type Formatters } from './lib/format';
export {
  bezierAt,
  cssEase,
  DUR,
  EASE_IN,
  EASE_IN_OUT,
  EASE_OUT,
  FOLD_DISTANCE,
  FOLD_MS,
  PRESS_SCALE,
  REDUCED_FADE,
  RISE,
  SIDEBAR_WIDTH,
  STAGGER,
  staggerDelay,
  SUCCESS_HOLD_MS,
  TICK_DURATION,
  type Bezier,
} from './lib/motion';
export { HOVER_EASE, POP_IN_OUT, PRESS_CONTROL, PRESS_ROW } from './lib/motion-classes';
export { MotionProvider } from './lib/motion-provider';
export { useFocusFallback } from './lib/use-focus-fallback';

// Core UI primitives (components/index.ts).
export * from './components';

// One glyph per concept and per verb, at three sizes (icons/index.ts).
export * from './icons';

// Kaatu, the brand's mascot (DESIGN.md, Mascot), and the line it sits in while the agent works.
export {
  MASCOT_SIZES,
  Kaatu,
  type KaatuAntic,
  type KaatuProps,
  type MascotMood,
  type MascotSpot,
} from './brand/mascot';
export { ANTIC_NAMES } from './brand/kaatu-acts';
// Kaatu as a companion (UX4): a moment (Kaatu and one line), and whether Kaatu shows at all (Show Kaatu).
export { KaatuMoment, type KaatuMomentProps, type KaatuMomentTone } from './brand/kaatu-moment';
export { KaatuPresenceProvider, useKaatuShown } from './brand/kaatu-presence';
export {
  HAPPY_MS,
  OOPS_MS,
  SLEEP_AFTER_MS,
  useIdleMood,
  useRunMood,
  type IdleMoodOptions,
  type RunMood,
  type RunMoodInput,
  type RunPhase,
} from './brand/use-mascot-mood';

// The preview player (P2-M7): <hyperframes-player> on render's host contract (packages/render/SPEC.md, section 5).
export { PreviewFrame, type PreviewFrameProps, type PreviewPhase } from './player/preview-frame';
export {
  PreviewPlayer,
  type PreviewPlayerHandle,
  type PreviewPlayerProps,
  type PreviewReady,
} from './player/preview-player';

export { AvartanMark, type AvartanMarkProps } from './window/avartan-mark';
export {
  WindowControl,
  WindowControls,
  type WindowAction,
  type WindowControlKind,
  type WindowControlProps,
  type WindowControlsProps,
} from './window/window-controls';
export { controlsOverlay, useWindowControlsOverlay, type ControlsOverlay } from './window/controls-overlay';
export {
  WindowBar,
  WindowTitle,
  type WindowBarLead,
  type WindowBarProps,
  type WindowTitleProps,
} from './window/window-bar';
// The page grid the bar and the page share (UX4): page-grid.css derives the column; the app's Page claims it.
export {
  claimPageGrid,
  layoutLeft,
  naturalTitleLeft,
  PAGE_WIDTHS,
  publishShellGrid,
  splitLegacyWidth,
  type PageWidth,
  type ShellGrid,
} from './window/page-grid';
// 8-state previews (Hallmark), shown on the app's /dev/kit page.
export { WindowControlsPreview } from './window/window-controls.preview';
export { WindowBarPreview } from './window/window-bar.preview';
export { MascotPreview } from './brand/mascot.preview';
export { PreviewPlayerPreview } from './player/preview-player.preview';

// Skeletons and stale content (skeleton/index.ts).
export * from './skeleton';

// Feedback, loaders, toasts, errors, and warnings (feedback/index.ts).
export * from './feedback';

// Smart cards and flow cards (cards/index.ts).
export * from './cards';
export * from './library/import-exports';
export { RhythmBed, Ruler, type RhythmBedProps } from './templates/breakdown-view';
export { BeatWaveform, drawWaveform, type BeatWaveformProps } from './templates/beat-waveform';
export { flattenedWaveform, reelWaveform } from './templates/waveform-shape';
export { SlotStrip, type SlotStripProps } from './templates/slot-strip';
export { sheetTileStyle } from './templates/sheet-tile';
export { OverlaysLane, type OverlaysLaneProps } from './templates/overlays-lane';
export { slotEditCommand, useSlotEdits, type SlotEdit } from './templates/use-slot-edits';
// BRK1-REV: the review, in the chat's sheet and on a template's Slots page.
export { TemplateReview, type TemplateReviewProps } from './templates/template-review';
export { ReviewSheet, type ReviewSheetProps } from './templates/review-sheet';
export { reviewEditCommand, type ReviewEdit } from './templates/use-review-edits';
export {
  checkItems,
  checkSummary,
  reviewCounts,
  type CheckItem,
  type ReviewCounts,
} from './templates/review-checks';
export { cutRange, cutTime, nudgeCut, placeCut, type CutPlace } from './templates/cut-math';
export { proposalGone, proposalWords, type ProposalWords } from './templates/proposal-words';
export { MOTION_LABELS, ROLE_LABELS, SHOT_TYPE_LABELS, toSeconds } from './templates/slot-words';
// UX3-TPL: what a template or a slot is, in its kind's colour beside its word (DESIGN.md "Kinds").
export {
  FAMILY_TONE,
  FORMAT_KIND,
  FORMAT_LABELS,
  FormatChip,
  FormatIcon,
  ROLE_KIND,
  RoleChip,
  type FormatFamily,
  type KindTone,
  type SlotRole,
} from './templates/kinds';

// Chat surfaces and motion primitives (chat/index.ts).
export * from './chat';

// Command palette and shortcuts.
export {
  CommandPalette,
  ShortcutKeys,
  type CommandPaletteProps,
  type PaletteItem,
} from './palette/command-palette';
export { fuzzyMatch, fuzzyRank, type FuzzyMatch, type Searchable } from './palette/fuzzy';
export { type PaletteWhy } from './palette/palette-why';
export {
  ariaKeyShortcuts,
  isEditableTarget,
  matchesShortcut,
  overlayOpen,
  parseShortcut,
  shortcutKeys,
  type KeyWords,
  type Shortcut,
} from './palette/shortcut';
export { useShortcutFormat, type ShortcutFormat } from './palette/key-words';
// The OS the app runs on (LNX1-SHL): shortcut keys, "This Mac" or "This computer", who draws the window's controls.
export {
  HOST_PLATFORMS,
  HostPlatformProvider,
  keyboardOf,
  platformFromNavigator,
  useHostPlatform,
  useKeyboard,
  type HostPlatform,
  type NavigatorPlatform,
} from './platform/host-platform';
// UX3-MAC: a sentence that names the Mac, and its words on every other computer (platform-words.ts).
export {
  macKey,
  onPlatform,
  platformWordsById,
  platformWordsOf,
  usePlatformChoice,
  withPlatformWords,
  type PlatformChoices,
  type PlatformWords,
} from './platform/platform-words';
export { KIT_PLATFORM_WORDS } from './platform/kit-platform-words';
export {
  fixOn,
  platformFeatures,
  usePlatformFeatures,
  type PlatformFeatures,
} from './platform/platform-features';
export {
  useCommandShortcuts,
  usePaletteShortcut,
  type CommandShortcutOptions,
} from './palette/use-command-shortcuts';

// Sidebar fold, rail tooltips, and gliding indicators (sidebar/index.ts).
export * from './sidebar';

// Theme engine, transitions, and controls (theme/index.ts).
export * from './theme';

// Make (P2-M3, P2-M7, P2-M8, P2-M11): timecodes, selection chips, shots, QA, render progress (make/index.ts).
export * from './make';

// Phase 3 (ui-make): each area's public surface, from its own folder.
export * from './recipes';
export * from './effects';
export * from './variants';
export * from './gaps';
export * from './hub';
export * from './cleanup';
export * from './looks';
export * from './media';

// LRN1-TPL: templates that fit the footage (the import card's group, the picker's order).
export * from './fit';
// LRN1-TPL: the Templates page's search results, each with what matched it (template-search/index.ts).
export * from './template-search';
// LRN1-MEM: Settings → Memory's item, its source badge and text field (memory/index.ts).
export * from './memory';
// LRN1-STY: what a set of references has in common: the Saved page's section and the chat card's body.
export * from './profiles';
