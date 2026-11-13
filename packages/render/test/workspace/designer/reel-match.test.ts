// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 tpl: the reel-match check holds a template design's render to where the reel's graphic sits, as wide: off by
 * 16 % on the side it hangs from, it fails and says where to anchor it; where the reel's is, it passes; a 9:16 reel's
 * small words grow to the floor about that side; a made video's longer words may be wider.
 */
import { describe, expect, it } from 'vitest';
import { drawnOverlay, expectedPlace, reelMatch } from '../../../src/workspace/designer/reel-match';
import { CAP_FLOOR_PX, DESIGN_CANVAS, overlayBrief } from '../../../src/workspace/template/brief';
import { madeUpReel } from '../template/reel-fixture';

const { width: W, height: H } = DESIGN_CANVAS;
const shares = (place: { left: number; top: number; width: number; height: number }) => ({
  x: place.left / W,
  y: place.top / H,
  width: place.width / W,
  height: place.height / H,
});

/** The made-up reel's message as a 16:9 reel's, hanging from the right like the owner's question. */
function wideRight() {
  const { template, question } = madeUpReel();
  const shape = { x: 0.25, y: 0.21, width: 0.27, height: 0.08 };
  const right = { ...question, design: { ...question.design!, tail: 'right' as const, shape } };
  const wide = { ...template, canvas: { ...template.canvas, width: 1080, height: 608 }, text: [right] };
  return overlayBrief(wide, right)!;
}

describe('the reel-match check (HFW1 tpl)', () => {
  it('fails a design 16 % right of the reel’s right edge, and says where to anchor it', () => {
    const brief = wideRight();
    const expected = expectedPlace(brief);
    expect(expected.side).toBe('right');
    // As the owner's plan run drew it: a wide box from near the left edge, its right edge 16 % past the reel's.
    const off = { ...expected, left: expected.left + 0.16 * W };
    const check = reelMatch(brief, shares(off));
    expect(check.status).toBe('fail');
    const right = Math.round(W - expected.left - expected.width);
    expect(check.detail).toContain(
      `your right edge is 16% right of the reel's: anchor it at right: ${right}px and hug the words ` +
        "(width: fit-content, padding as the reel's)",
    );
  });

  it('passes a design where the reel’s is, and fails one twice as wide, saying so', () => {
    const brief = wideRight();
    const expected = expectedPlace(brief);
    expect(reelMatch(brief, shares(expected))).toEqual({ id: 'reelMatch', status: 'pass' });
    const wide = { ...expected, left: expected.left - expected.width, width: expected.width * 2 };
    const check = reelMatch(brief, shares(wide));
    expect(check.status).toBe('fail');
    expect(check.detail).toMatch(/×2\.00 the reel's .*hug the words/);
    // A made video's words half as long again may be that much wider.
    const longer = { ...expected, left: expected.left - expected.width * 0.6, width: expected.width * 1.6 };
    expect(reelMatch(brief, shares(longer), 1.5).status).toBe('pass');
    expect(reelMatch(brief, null).status).toBe('skipped');
  });

  it('holds a 9:16 reel to its own place, its small words grown to the floor about the side it hangs from', () => {
    const { template, question } = madeUpReel();
    const brief = overlayBrief(template, question)!;
    const expected = expectedPlace(brief);
    const grow = CAP_FLOOR_PX / brief.size.capHeightPx;
    expect(expected.left).toBe(brief.place.px.left);
    expect(expected.width).toBeCloseTo(brief.size.shapePx!.width * grow, 0);
    expect(reelMatch(brief, shares(expected)).status).toBe('pass');
    // The template Designer's stub still sits there too (template-designer.test.ts).
    expect(reelMatch(brief, { x: 0.06, y: 0.373, width: 0.57, height: 0.06 }).status).toBe('pass');
  });

  it('knows which overlay a render drew by its words, and how much longer other words are', () => {
    const { template, question, reply } = madeUpReel();
    const briefs = [overlayBrief(template, question)!, overlayBrief(template, reply)!];
    expect(drawnOverlay(briefs, { text: reply.text }).overlay.overlayId).toBe(reply.id);
    expect(drawnOverlay(briefs, undefined)).toMatchObject({
      overlay: { overlayId: question.id },
      wordsRatio: 1,
    });
    const twice = `${question.text} ${question.text}`;
    expect(drawnOverlay(briefs, { text: twice }).wordsRatio).toBeCloseTo(twice.length / question.text.length);
  });
});
