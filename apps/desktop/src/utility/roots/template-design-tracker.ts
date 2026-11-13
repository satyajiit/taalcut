// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-GFXWAIT: which templates' graphics are being designed in this agent process (agent-template-designing.ts),
 * so a make from one waits for them (timeline's `graphicsReady`, read by timeline.cast and timeline.assemble).
 * A design is begun as soon as the template's creation commits, before it queues behind another template's, and is
 * always settled, done or not. A wait is bounded: past the deadline it answers timedOut and the design goes on.
 */
import { createToken, type TemplateId } from '@taalcut/core';
import { GRAPHICS_WAIT_MAX_MS, type GraphicsReady, type GraphicsWait } from '@taalcut/timeline';

/** How a template's design ended: how many of its graphics passed, and the overlays left without one. */
export interface DesignSettled {
  readonly designed: number;
  readonly total: number;
  readonly missing: GraphicsWait['missing'];
}

export interface TemplateDesignTracker {
  /**
   * A design of the template's graphic overlays starts: the returned function settles it (once; later calls do
   * nothing). A wait past the deadline names these overlays as still being designed.
   */
  begin(templateId: TemplateId, overlayIds: readonly string[]): (settled: DesignSettled) => void;
  /** Whether a design of the template is running now. */
  running(templateId: TemplateId): boolean;
  /** Timeline's `graphicsReady`: waits for a running design, at most the deadline; null when none is running. */
  readonly wait: GraphicsReady;
}

export const TemplateDesignTrackerToken = createToken<TemplateDesignTracker>('desktop.templateDesigns');

/** The reason a wait past its deadline gives each overlay (the model reads it; the person sees the Editor's words). */
const STILL_DESIGNING = 'still being designed when the make went on';

function statusOf(settled: DesignSettled): GraphicsWait['status'] {
  if (settled.total > 0 && settled.designed >= settled.total) return 'designed';
  return settled.designed > 0 ? 'partly' : 'failed';
}

export function createTemplateDesignTracker(
  options: { readonly maxWaitMs?: number; readonly now?: () => number } = {},
): TemplateDesignTracker {
  const maxWaitMs = options.maxWaitMs ?? GRAPHICS_WAIT_MAX_MS;
  const now = options.now ?? Date.now;
  const designs = new Map<TemplateId, { done: Promise<DesignSettled>; overlayIds: readonly string[] }>();

  return {
    begin(templateId, overlayIds) {
      let settle: (settled: DesignSettled) => void = () => {};
      const done = new Promise<DesignSettled>((resolve) => (settle = resolve));
      const entry = { done, overlayIds: [...overlayIds] };
      designs.set(templateId, entry);
      let open = true;
      return (settled) => {
        if (!open) return;
        open = false;
        settle(settled);
        if (designs.get(templateId) === entry) designs.delete(templateId);
      };
    },
    running: (templateId) => designs.has(templateId),
    async wait(templateId, signal) {
      const design = designs.get(templateId);
      if (!design) return null;
      const { overlayIds } = design;
      const started = now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const late = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), maxWaitMs);
        onAbort = () => resolve(null);
        if (signal.aborted) resolve(null);
        else signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        const settled = await Promise.race([design.done, late]);
        const waitedMs = Math.max(0, Math.round(now() - started));
        if (!settled)
          return {
            status: 'timedOut',
            waitedMs,
            designed: 0,
            total: overlayIds.length,
            missing: overlayIds.map((overlayId) => ({ overlayId, reason: STILL_DESIGNING })),
          };
        return { status: statusOf(settled), waitedMs, ...settled };
      } finally {
        if (timer) clearTimeout(timer);
        if (onAbort) signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
