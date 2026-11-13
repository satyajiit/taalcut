// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Names the package index already exports. The section lists live on each format module and the registry
 * (registry.ts) is the one list of formats; this file only re-exports.
 */
export type { FormatSection, IntentSeed, SectionBeats } from './format-module';
export { VLOG_SECTIONS } from './catalog/vlog';
export { DAY_IN_THE_LIFE_SECTIONS } from './catalog/day-in-the-life';
