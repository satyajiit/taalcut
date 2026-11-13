// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-STORY: the graphics each slot plays under, by kind, so casting knows what the footage needs (a chat over a slot
 * wants someone on a phone; terms.ts turns kinds into words). An overlay's kind is what DSG1's reading says it is (a
 * brief that calls it footage, a sign or a screen, drops it), else a message when the breakdown measured a chat
 * bubble (BRK1-GFX). It counts for the slot it starts in (`slotId`) and
 * for every slot it overlaps for at least half of the shorter of the two.
 */
import { RationalTime, type Template, type TextOverlay } from '@taalcut/core';
import { isGraphicOverlay } from '../assembly/designed';
import type { GraphicKind } from './terms';

function kindOf(template: Template, overlay: TextOverlay): GraphicKind | null {
  const graphics = template.graphics;
  const brief = graphics?.reading?.briefs.find((entry) => entry.overlayId === overlay.id);
  if (brief) return brief.graphic ? brief.kind : null;
  return isGraphicOverlay(overlay.design) && overlay.design.kind === 'chatBubble' ? 'incomingMessage' : null;
}

/** Per slot, in order: the kinds of the graphics over it, once each. */
export function slotGraphicKinds(template: Template): GraphicKind[][] {
  const rate = template.canvas.rate;
  const frames = (time: RationalTime) => RationalTime.rescale(time, rate, 'round').value;
  const overlays = template.text.flatMap((overlay) => {
    const kind = kindOf(template, overlay);
    if (!kind) return [];
    const start = frames(overlay.start);
    return [{ kind, slotId: overlay.slotId, start, end: start + frames(overlay.duration) }];
  });
  return template.slots.map((slot) => {
    const start = frames(slot.start);
    const end = start + frames(slot.duration);
    const kinds = new Set<GraphicKind>();
    for (const overlay of overlays) {
      const shared = Math.min(end, overlay.end) - Math.max(start, overlay.start);
      const shorter = Math.min(end - start, overlay.end - overlay.start);
      if (overlay.slotId === slot.id || (shorter > 0 && 2 * shared >= shorter)) kinds.add(overlay.kind);
    }
    return [...kinds];
  });
}
