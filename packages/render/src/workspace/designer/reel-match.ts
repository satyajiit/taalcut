// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 tpl: the reel-match check, a template Designer's frame check of its own. A render of a template's design is
 * held to where the brief says the reel's graphic sits on the canvas (brief.ts `reelOnCanvas`), grown about the side
 * it hangs from when its words rise to the type floor: the edge it hangs from and its middle down within 3 % of the
 * frame, and its width 0.75 to 1.35 × the reel's at the reel's words (a made video's longer words get WORDS_GROWTH
 * more, shorter ones less). Its fix names the side, the distance and the px to anchor it at. design.done refuses
 * while it fails, as for the other frame checks. Pure.
 */
import type { CompositionGateCheck } from '@taalcut/core';
import { CAP_FLOOR_PX, DESIGN_CANVAS, WORDS_GROWTH, type OverlayBrief } from '../template/brief';

export const REEL_MATCH = { edge: 0.03, middle: 0.03, minWidth: 0.75, maxWidth: 1.35 } as const;

/** Where the reel's graphic sits on the canvas, px: the brief's place, grown about its side to the type floor. */
export interface ExpectedPlace {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly side: OverlayBrief['place']['side'];
}

const clamp = (value: number, high: number) => Math.min(Math.max(0, value), Math.max(0, high));

export function expectedPlace(overlay: OverlayBrief): ExpectedPlace {
  const { width: W, height: H } = DESIGN_CANVAS;
  const { px, side } = overlay.place;
  const reelWidth = W - px.left - px.right;
  const reelHeight = H - px.top - px.bottom;
  const grow = Math.max(1, CAP_FLOOR_PX / Math.max(1, overlay.size.capHeightPx));
  const width = Math.min(W, reelWidth * grow);
  const height = Math.min(H, reelHeight * grow);
  const anchor = side === 'left' ? px.left : side === 'right' ? W - px.right : px.left + reelWidth / 2;
  const left = side === 'left' ? anchor : side === 'right' ? anchor - width : anchor - width / 2;
  return {
    left: clamp(left, W - width),
    top: clamp(px.top + reelHeight / 2 - height / 2, H - height),
    width,
    height,
    side,
  };
}

const pct = (share: number) => `${Math.round(Math.abs(share) * 100)}%`;

/**
 * The check on a render's content box (shares of the canvas) for the overlay drawn. `wordsRatio`: the drawn words'
 * length over the reel's (1 when drawn with the reel's words).
 */
export function reelMatch(
  overlay: OverlayBrief,
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null,
  wordsRatio = 1,
): CompositionGateCheck {
  if (!box)
    return { id: 'reelMatch', status: 'skipped', detail: 'nothing was drawn to compare with the reel' };
  const { width: W, height: H } = DESIGN_CANVAS;
  const expected = expectedPlace(overlay);
  const drawn = { left: box.x * W, right: (box.x + box.width) * W, width: box.width * W };
  const side = expected.side;
  const at =
    side === 'left'
      ? drawn.left - expected.left
      : side === 'right'
        ? drawn.right - (expected.left + expected.width)
        : drawn.left + drawn.width / 2 - (expected.left + expected.width / 2);
  const down = (box.y + box.height / 2) * H - (expected.top + expected.height / 2);
  const ratio = drawn.width / expected.width;
  const longer = Math.min(WORDS_GROWTH, Math.max(1, wordsRatio));
  const shorter = Math.min(1, wordsRatio);
  const [low, high] = [REEL_MATCH.minWidth * shorter, REEL_MATCH.maxWidth * longer];
  const fixes: string[] = [];
  if (Math.abs(at) / W > REEL_MATCH.edge) {
    const where = side === 'centre' ? 'middle' : `${side} edge`;
    const anchor =
      side === 'left'
        ? `left: ${Math.round(expected.left)}px`
        : side === 'right'
          ? `right: ${Math.round(W - expected.left - expected.width)}px`
          : `its middle ${Math.round(expected.left + expected.width / 2)}px from the left`;
    fixes.push(
      `your ${where} is ${pct(at / W)} ${at > 0 ? 'right' : 'left'} of the reel's: anchor it at ${anchor} and hug ` +
        "the words (width: fit-content, padding as the reel's)",
    );
  }
  if (Math.abs(down) / H > REEL_MATCH.middle)
    fixes.push(
      `your middle is ${pct(down / H)} ${down > 0 ? 'below' : 'above'} the reel's: put its middle ` +
        `${Math.round(expected.top + expected.height / 2)}px from the top`,
    );
  if (ratio > high || ratio < low)
    fixes.push(
      `it is ${Math.round(drawn.width)}px wide, ×${ratio.toFixed(2)} the reel's ${Math.round(expected.width)}px ` +
        `for these words: ${
          ratio > high
            ? "hug the words (width: fit-content, no set width, padding as the reel's)"
            : `give it the reel's padding and type (${Math.max(CAP_FLOOR_PX, overlay.size.capHeightPx)} px cap height)`
        }`,
    );
  return fixes.length
    ? { id: 'reelMatch', status: 'fail', detail: `${fixes.join('; ')}.`.slice(0, 500) }
    : { id: 'reelMatch', status: 'pass' };
}

/** The overlay a render drew: the one whose words are among its params' values, else the brief's lead. */
export function drawnOverlay(
  overlays: readonly OverlayBrief[],
  params: Readonly<Record<string, unknown>> | undefined,
): { overlay: OverlayBrief; wordsRatio: number } {
  const lead = overlays[0]!;
  const strings = Object.values(params ?? {}).filter((value): value is string => typeof value === 'string');
  const named = overlays.find((overlay) => strings.includes(overlay.words));
  if (named) return { overlay: named, wordsRatio: 1 };
  // Other words: the `text` variable's (the brief's name for the words), else the longest value given.
  const text = typeof params?.text === 'string' ? params.text : null;
  const longest = text?.length ?? strings.reduce((most, value) => Math.max(most, value.length), 0);
  return { overlay: lead, wordsRatio: longest > 0 ? longest / Math.max(1, lead.words.length) : 1 };
}
