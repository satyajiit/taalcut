// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: slotGraphics, the reel's graphics in the draft and in the reel's place. Every overlay the reel draws as
 * a graphic needs a graphic on the draft that draws it (its `overlay.id`), and that graphic's box, as the DOM probe
 * read it in the middle of its time, is held to the reel's place by HFW1's `reelMatch` (the edge it hangs from and
 * its middle within 3 % of the frame, its width within the band for its words). A missing graphic fails with the
 * slot's frames; a misplaced one with how far off it is. Each fix names the slot, the overlay and the tools.
 */
import type { QaCheckResult, Rect } from '@taalcut/core';
import { DESIGN_CANVAS } from '../../../workspace/template/brief';
import { expectedPlace, reelMatch } from '../../../workspace/designer/reel-match';
import { agentFix, checkResult, skipped, type QaFinding } from '../../result';
import type { SlotGraphicFact, SlotMatchFact } from './facts';

/** The probe's box of a graphic at a frame, canvas pixels; null when it saw none. */
export type GraphicBoxAt = (itemId: string, frame: number) => Rect | null;

const pct = (share: number) => Math.round(share * 100);

interface GraphicMiss {
  readonly graphic: SlotGraphicFact;
  readonly finding: QaFinding;
  readonly params: Readonly<Record<string, string | number>>;
}

function placeMiss(fact: SlotMatchFact, graphic: SlotGraphicFact, box: Rect): GraphicMiss | null {
  const share = {
    x: box.x / fact.canvas.width,
    y: box.y / fact.canvas.height,
    width: box.width / fact.canvas.width,
    height: box.height / fact.canvas.height,
  };
  const check = reelMatch(graphic.brief, share, graphic.wordsRatio);
  if (check.status !== 'fail') return null;
  const expected = expectedPlace(graphic.brief);
  const across = share.x + share.width / 2 - (expected.left + expected.width / 2) / DESIGN_CANVAS.width;
  const down = share.y + share.height / 2 - (expected.top + expected.height / 2) / DESIGN_CANVAS.height;
  const width = (share.width * DESIGN_CANVAS.width) / Math.max(1, expected.width);
  return {
    graphic,
    finding: {
      ...(graphic.span ? { frames: { start: graphic.span.start, end: graphic.span.end } } : {}),
      target: { kind: 'text', id: graphic.itemId! },
      measured: { value: pct(Math.max(Math.abs(across), Math.abs(down))), unit: 'percent' },
    },
    params: {
      itemId: graphic.itemId!,
      side: graphic.brief.place.side,
      acrossPct: pct(across),
      downPct: pct(down),
      widthPct: pct(width),
      tools: 'graphics.edit, graphics.design, workspace.patch, workspace.renderOver',
    },
  };
}

export function slotGraphicsCheck(fact: SlotMatchFact, boxAt: GraphicBoxAt | null): QaCheckResult {
  if (fact.graphics.length === 0) return skipped('slotGraphics');
  const misses: GraphicMiss[] = [];
  let unread = 0;
  for (const graphic of fact.graphics) {
    const slot = fact.slots.find((entry) => entry.slotId === graphic.slotId);
    if (!graphic.itemId) {
      misses.push({
        graphic,
        finding: {
          ...(slot?.span ? { frames: { start: slot.span.start, end: slot.span.end } } : {}),
          ...(slot ? { target: { kind: 'clip' as const, id: slot.target } } : {}),
          measured: { value: 1, unit: 'count' },
        },
        params: {
          overlayId: graphic.overlayId,
          missing: 1,
          tools: 'graphics.design, graphics.list, workspace.place',
        },
      });
      continue;
    }
    const box = boxAt && graphic.hold !== null ? boxAt(graphic.itemId, graphic.hold) : null;
    if (!box) {
      unread++;
      continue;
    }
    const miss = placeMiss(fact, graphic, box);
    if (miss) misses.push(miss);
  }
  // Graphics on the draft that the probe couldn't read, and nothing else to judge: QA saw nothing to pass.
  if (misses.length === 0 && unread === fact.graphics.length) return skipped('slotGraphics');
  const sorted = misses.sort((a, b) => (a.graphic.number ?? 0) - (b.graphic.number ?? 0));
  return checkResult(
    'slotGraphics',
    // As the other slot checks: a miss warns, and video.done holds the AI to it.
    sorted.length > 0 ? 'warn' : 'pass',
    {
      measured: { value: sorted.length, unit: 'count' },
      threshold: { max: 0, unit: 'count' },
      findings: sorted.map((miss) => miss.finding),
      fixes: sorted.map((miss) =>
        agentFix('qa.fixes.matchSlotGraphics', {
          ...(miss.graphic.number !== null ? { slot: miss.graphic.number } : {}),
          ...(miss.graphic.slotId ? { slotId: miss.graphic.slotId } : {}),
          overlayId: miss.graphic.overlayId,
          ...miss.params,
        }),
      ),
    },
    0,
  );
}
