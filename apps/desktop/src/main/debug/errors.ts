// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Debug-bundle and feedback failures. `params` name the section and the rule,
 * never the text that matched.
 */
import { defineError } from '@taalcut/core';

export const DebugBundleUnsafe = defineError<{ section: string; rule: string }>(
  'desktop.debug_bundle_unsafe',
);

/** No crash DSN is configured, so feedback cannot be sent. Saving a bundle still works. */
export const FeedbackUnavailable = defineError('desktop.feedback_unavailable');
