// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the update pipeline reports (updater.ts, manifest-gate.ts), one event per step, to start.ts's sink, the
 * host and the log. Its own module so the gate and the pipeline both read it without importing each other.
 */
import type { TaalcutError } from '@taalcut/core';

export type UpdateEvent =
  | { readonly type: 'checking'; readonly feedUrl: string }
  | { readonly type: 'available'; readonly version: string }
  /** The offer's notes (the channel yml's releaseNotes, as text) and date, right after 'available'. */
  | {
      readonly type: 'release-info';
      readonly version: string;
      readonly releaseNotes?: string;
      readonly releaseDate?: string;
    }
  /** The update library is fetching only the changed blocks (blockmap); 'delta-failed' when it fell back. */
  | { readonly type: 'delta' }
  | { readonly type: 'delta-failed' }
  | { readonly type: 'not-available'; readonly version: string }
  | { readonly type: 'progress'; readonly percent: number }
  | { readonly type: 'downloaded'; readonly version: string }
  | { readonly type: 'verified'; readonly version: string; readonly team: string }
  | { readonly type: 'rejected'; readonly error: TaalcutError }
  | { readonly type: 'staged' }
  | { readonly type: 'error'; readonly message: string };
