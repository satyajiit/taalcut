// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `downloads.json` beside the registry: whether the person asked for everything this Mac needs, whether they
 * paused it, what goes first, which components this download is about (so its bar keeps its size across a
 * restart), and why it couldn't start. Each component's own last failure is the manager's (`failures.json`).
 */
import { taalcutErrorSchema } from '@taalcut/core';
import { z } from 'zod';

export const SavedDownloadsSchema = z.object({
  v: z.literal(1),
  /** The download was asked for: at launch it goes on by itself (unless paused) until everything is here. */
  requested: z.boolean(),
  paused: z.boolean(),
  /** Components to fetch before the rest (a clip's models), as last asked. */
  first: z.array(z.string()),
  /** The components this download fetches, installed ones included once it has finished them. */
  batch: z.array(z.string()),
  /** Why it couldn't start or go on (disk space, the manifest, the hardware probe). */
  error: taalcutErrorSchema.optional(),
});
export type SavedDownloads = z.infer<typeof SavedDownloadsSchema>;

export const NOTHING_ASKED = (): SavedDownloads => ({
  v: 1,
  requested: false,
  paused: false,
  first: [],
  batch: [],
});
