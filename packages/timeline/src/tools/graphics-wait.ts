// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-GFXWAIT: a template made from a reel has its graphics designed in the background (the app's template design),
 * and a make from it used to go on without them: the reel's chat bubbles were missing from the video. So the casting
 * tools wait for a design still running on the template they read, at most `GRAPHICS_WAIT_MAX_MS`, then read its
 * newest version, which holds the compositions assembly places. The variants question is asked before the cast, so
 * the person answers it while the graphics are designed. A template with nothing being designed never waits.
 */
import { z } from 'zod';
import type { TemplateId } from '@taalcut/core';

/** The longest a make waits for a template's graphics before it goes on without the ones not designed yet. */
export const GRAPHICS_WAIT_MAX_MS = 12 * 60_000;

export const graphicsWaitSchema = z.object({
  /** designed: every graphic; partly: some; failed: none passed; timedOut: still designing at the deadline. */
  status: z.enum(['designed', 'partly', 'failed', 'timedOut']),
  waitedMs: z.int().nonnegative(),
  designed: z.int().nonnegative(),
  total: z.int().nonnegative(),
  /** The template overlays left without a design: graphics.design can make them in the Editor. */
  missing: z.array(z.object({ overlayId: z.string().min(1).max(64), reason: z.string().max(300) })).max(48),
});
export type GraphicsWait = z.output<typeof graphicsWaitSchema>;

/**
 * Waits for the template's graphics while they are being designed and says how it went; null when none is being
 * designed (nothing waited). Ends early, as timedOut, when `signal` aborts.
 */
export type GraphicsReady = (templateId: TemplateId, signal: AbortSignal) => Promise<GraphicsWait | null>;
