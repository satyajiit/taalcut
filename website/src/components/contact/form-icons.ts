// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { ChevronDown, CircleAlert, LoaderCircle, RotateCcw, WifiOff, type LucideIcon } from 'lucide-react';

/**
 * The forms' status glyphs, the app's own choices (packages/ui/src/icons/concepts.ts: `error`, `offline`, `retry`,
 * the kit's spinner and the select's chevron). They belong in #lib/icons; the WEB1 hand-off asks the foundation to move them there, and
 * this file goes once they are.
 */
export const FORM_ICONS = {
  error: CircleAlert,
  offline: WifiOff,
  retry: RotateCcw,
  spinner: LoaderCircle,
  chevron: ChevronDown,
} as const satisfies Record<string, LucideIcon>;
