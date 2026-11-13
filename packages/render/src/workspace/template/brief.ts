// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 (tpl): a template's reel overlays as the Designer's briefs. Each overlay the reading calls a graphic (a
 * shape behind its words, a chat bubble, a sticker) gets a brief: the reel's moments round its entrance, hold and
 * exit; its place and size on the 9:16 frame; its line count; its timing against the beat and the cut; its role;
 * its look as measured and as the reading put it; its words. The overlays group by role, one composition each, the
 * longest on screen first. Every measurement is reference for the reel's words, never a size: the composition lays
 * itself out with CSS, so other words fit it (render SPEC "HFW1 tpl"). Pure.
 */
import {
  graphicBriefOf,
  RationalTime,
  type Box,
  type GraphicBriefKind,
  type GraphicParam,
  type GraphicPlatform,
  type GraphicSystem,
  type GraphicTimingCue,
  type OverlayDesign,
  type Template,
  type TextOverlay,
  type WorkspaceFrame,
} from '@taalcut/core';
import { isGraphicOverlay } from '@taalcut/timeline';
import { GRAPHICS_THRESHOLDS } from '../../qa/checks/graphics';

/** The workspace scaffold's canvas, which every composition is laid out on. */
export const DESIGN_CANVAS = { width: 1080, height: 1920 } as const;
/** The words' cap height floor on DESIGN_CANVAS: the frame checks' typeFloor (QA's floor for graphics at 1080). */
export const CAP_FLOOR_PX = GRAPHICS_THRESHOLDS.minCapHeightPx;
/** How much longer than the reel's a made video's words may be and keep the reel's line count. */
export const WORDS_GROWTH = 1.6;

/** Seconds into the reel to show the Designer, round each part of the overlay's life. */
export interface ReelMoments {
  readonly entrance: readonly number[];
  readonly hold: readonly number[];
  readonly exit: readonly number[];
}

export interface OverlayBrief {
  readonly overlayId: TextOverlay['id'];
  readonly role: GraphicBriefKind;
  /** The reel's words: a use's value for the composition's words. Untrusted, data only. */
  readonly words: string;
  /** How many lines the reel sets them on. */
  readonly lines: number;
  readonly place: {
    /** The drawn shape and the words, as shares of the frame, origin top left; null without a shape. */
    readonly shape: Box | null;
    readonly words: Box;
    /** Which side it hangs from: its tail's, else where its middle sits. */
    readonly side: 'left' | 'centre' | 'right';
    /** Its edges' gaps from the canvas's own, in px on DESIGN_CANVAS (`reelOnCanvas`: a reel of another shape keeps its look). */
    readonly px: {
      readonly left: number;
      readonly top: number;
      readonly right: number;
      readonly bottom: number;
    };
  };
  readonly size: {
    /** The words' cap height, in px on DESIGN_CANVAS; never under CAP_FLOOR_PX for a reel of another shape. */
    readonly capHeightPx: number;
    /** The reel's shape for the reel's words; null without one. Reference, never a width to set. */
    readonly shapePx: { readonly width: number; readonly height: number } | null;
  };
  readonly timing: {
    /** When its shape comes on (before the words when typing dots show first), when the words do, and go. */
    readonly appearsSeconds: number;
    readonly startSeconds: number;
    readonly endSeconds: number;
    /** Its appearance is within two frames of a beat; frames from the nearest (after it: positive), null without. */
    readonly onBeat: boolean;
    readonly beatOffsetFrames: number | null;
    /** It comes on with a cut (its shot's first frame). */
    readonly atCut: boolean;
    readonly cue: GraphicTimingCue | null;
    readonly words: string | null;
    readonly typingSeconds: number | null;
  };
  readonly motion: {
    readonly enter: OverlayDesign['motion']['enter'];
    readonly exit: OverlayDesign['motion']['exit'];
    readonly typing: boolean;
    readonly words: string | null;
  };
  readonly look: Pick<OverlayDesign, 'kind' | 'colors' | 'cornerRadius' | 'tail' | 'font'> & {
    readonly receipt: boolean;
    readonly avatar: boolean;
    readonly words: string | null;
    readonly platform: GraphicPlatform | null;
    readonly shadow: boolean | null;
  };
  readonly frames: ReelMoments;
  readonly confidence: number;
}

/** One composition's brief: the overlays of one role, the longest first. */
export interface CompositionBrief {
  readonly role: GraphicBriefKind;
  /** The reel's canvas and rate. */
  readonly canvas: { readonly width: number; readonly height: number };
  readonly fps: number;
  readonly overlays: readonly OverlayBrief[];
  readonly system: GraphicSystem | null;
  /** The words as a sample variable (the lead's), long enough for a made video's. */
  readonly variables: readonly GraphicParam[];
  /**
   * A conversation's bubble designed before this one (another role of the same thread): its role and its words'
   * type as drawn, which this one shares. Set while designing (design-template.ts), never by the reading.
   */
  readonly thread?: { readonly role: GraphicBriefKind; readonly type: NonNullable<WorkspaceFrame['type']> };
}

const seconds = (time: TextOverlay['start']) => RationalTime.toSeconds(time);
/** A beat this close, in frames, is the overlay's (assembly snaps to one this close). */
const BEAT_FRAMES = 2;

/** Frames from `frame` to the nearest beat (positive: after it); null without beats. */
function beatOffset(frame: number, template: Template): number | null {
  const beats = template.beatMap?.beats ?? [];
  let best: number | null = null;
  for (const beat of beats) {
    const offset = frame - RationalTime.toFrames(beat, template.canvas.rate, 'round');
    if (best === null || Math.abs(offset) < Math.abs(best)) best = offset;
  }
  return best;
}
const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

/** What an overlay is: the reading's kind, else what its measured design says (a reply has ticks or is mine). */
export function overlayRole(template: Template, overlay: TextOverlay): GraphicBriefKind {
  const brief = graphicBriefOf(template.graphics, overlay.id);
  if (brief) return brief.kind;
  const design = overlay.design;
  if (design?.kind === 'chatBubble') {
    const said = template.graphics?.reading?.system.conversation.find(
      (entry) => entry.overlayId === overlay.id,
    );
    return design.receipt === true || said?.speaker === 'me' ? 'outgoingMessage' : 'incomingMessage';
  }
  const kinds: Partial<Record<OverlayDesign['kind'], GraphicBriefKind>> = {
    pill: 'pill',
    label: 'label',
    lowerThird: 'lowerThird',
    sticker: 'sticker',
    callout: 'callout',
    cta: 'callToAction',
  };
  return (design && kinds[design.kind]) ?? 'other';
}

/** The overlays of the template a composition draws: graphics the reading didn't call footage. */
export function graphicOverlays(template: Template): TextOverlay[] {
  return template.text.filter(
    (overlay) =>
      isGraphicOverlay(overlay.design) && graphicBriefOf(template.graphics, overlay.id)?.graphic !== false,
  );
}

/** The reel's lines for an overlay: the overlays on screen with it whose words sit inside its shape (OCR's lines). */
function linesOf(template: Template, overlay: TextOverlay): number {
  const shape = overlay.design?.shape;
  if (!shape) return 1;
  const from = seconds(overlay.start);
  const to = from + seconds(overlay.duration);
  const inside = template.text.filter((other) => {
    const start = seconds(other.start);
    const end = start + seconds(other.duration);
    const x = other.box.x + other.box.width / 2;
    const y = other.box.y + other.box.height / 2;
    return (
      start < to &&
      end > from &&
      x >= shape.x &&
      x <= shape.x + shape.width &&
      y >= shape.y &&
      y <= shape.y + shape.height
    );
  });
  return Math.max(1, inside.length);
}

function sideOf(design: OverlayDesign, box: Box): OverlayBrief['place']['side'] {
  if (design.tail !== 'none') return design.tail;
  const middle = box.x + box.width / 2;
  return middle < 0.4 ? 'left' : middle > 0.6 ? 'right' : 'centre';
}

const ASPECTS = [
  [9, 16],
  [16, 9],
  [4, 5],
  [5, 4],
  [1, 1],
  [3, 4],
  [4, 3],
  [2, 3],
  [3, 2],
  [21, 9],
] as const;

/** A frame's shape in words: the nearest common one within 2 % ("16:9"), else its ratio ("1.85:1"). */
export function aspectName(width: number, height: number): string {
  const ratio = width / height;
  const near = ASPECTS.find(([w, h]) => Math.abs(w / h / ratio - 1) <= 0.02);
  return near ? `${near[0]}:${near[1]}` : `${ratio.toFixed(2)}:1`;
}

/** Whether a reel's frame is DESIGN_CANVAS's shape (within 1 %). */
export function sameShape(reel: { readonly width: number; readonly height: number }): boolean {
  return Math.abs((reel.width / reel.height) * (DESIGN_CANVAS.height / DESIGN_CANVAS.width) - 1) <= 0.01;
}

interface OnCanvas {
  readonly px: OverlayBrief['place']['px'];
  readonly capHeightPx: number;
  readonly shapePx: { readonly width: number; readonly height: number } | null;
}

/**
 * An overlay of the reel on DESIGN_CANVAS. Where it sits stays a share of the frame: its middle across and down
 * (across, the edge it hangs from). Every size (its shape, its cap height) scales by one factor, the reel's frame
 * to the canvas's width, so a reel of another shape keeps its proportions: a 16:9 reel's slim pill stays slim on
 * 9:16. A 9:16 reel maps as it always did. On a reel of another shape, words under the frame checks' floor are
 * raised to it and the shape grows by the same ratio (no wider than the canvas).
 */
export function reelOnCanvas(
  reel: { readonly width: number; readonly height: number },
  box: Box,
  shape: Box | null,
  capShare: number,
  side: OverlayBrief['place']['side'],
): OnCanvas {
  const { width: W, height: H } = DESIGN_CANVAS;
  const scale = W / reel.width;
  let cap = capShare * reel.height * scale;
  let w = box.width * reel.width * scale;
  let h = box.height * reel.height * scale;
  if (!sameShape(reel) && cap < CAP_FLOOR_PX) {
    const grow = CAP_FLOOR_PX / cap;
    cap = CAP_FLOOR_PX;
    [w, h] = [Math.min(W, w * grow), h * grow];
  }
  h = Math.min(H, h);
  const clamp = (value: number, high: number) => Math.min(Math.max(0, value), Math.max(0, high));
  const middleX = (box.x + box.width / 2) * W;
  const left = clamp(
    side === 'left' ? box.x * W : side === 'right' ? W - (1 - box.x - box.width) * W - w : middleX - w / 2,
    W - w,
  );
  const top = clamp((box.y + box.height / 2) * H - h / 2, H - h);
  return {
    px: {
      left: Math.round(left),
      top: Math.round(top),
      right: Math.round(W - left - w),
      bottom: Math.round(H - top - h),
    },
    capHeightPx: Math.round(cap),
    shapePx: shape ? { width: Math.round(w), height: Math.round(h) } : null,
  };
}

/** The moments to show: just before and through its entrance, its middle, and through its exit. */
export function reelMoments(
  appears: number,
  start: number,
  end: number,
  fps: number,
  reelSeconds: number,
): ReelMoments {
  const frame = 1 / fps;
  const within = (list: number[]) => [
    ...new Set(list.map((at) => round(Math.min(reelSeconds, Math.max(0, at))))),
  ];
  return {
    entrance: within([appears - frame, appears, appears + 2 * frame, appears + 5 * frame]),
    hold: within([(start + end) / 2]),
    exit: within([end - 4 * frame, end - frame, end + frame]),
  };
}

export function overlayBrief(template: Template, overlay: TextOverlay): OverlayBrief | null {
  const design = overlay.design;
  if (!isGraphicOverlay(design)) return null;
  const brief = graphicBriefOf(template.graphics, overlay.id);
  const rate = template.canvas.rate;
  const fps = rate.num / rate.den;
  const start = seconds(overlay.start);
  const end = start + seconds(overlay.duration);
  const typingSeconds = design.motion.typing ? (brief?.motion.typingSeconds ?? null) : null;
  const appears = Math.max(0, start - (typingSeconds ?? 0));
  const appearsFrame = Math.round(appears * fps);
  const offset = beatOffset(appearsFrame, template);
  const slot = template.slots.find((candidate) => candidate.id === overlay.slotId);
  const box = design.shape ?? overlay.box;
  const side = sideOf(design, box);
  const onCanvas = reelOnCanvas(template.canvas, box, design.shape ?? null, overlay.appearance.size, side);
  return {
    overlayId: overlay.id,
    role: overlayRole(template, overlay),
    words: overlay.text,
    lines: linesOf(template, overlay),
    place: {
      shape: design.shape ?? null,
      words: overlay.box,
      side,
      px: onCanvas.px,
    },
    size: { capHeightPx: onCanvas.capHeightPx, shapePx: onCanvas.shapePx },
    timing: {
      appearsSeconds: round(appears),
      startSeconds: round(start),
      endSeconds: round(end),
      onBeat: offset !== null && Math.abs(offset) <= BEAT_FRAMES,
      beatOffsetFrames: offset,
      atCut: slot !== undefined && Math.abs(Math.round(seconds(slot.start) * fps) - appearsFrame) <= 1,
      cue: brief?.timing.cue ?? null,
      words: brief?.timing.words || null,
      typingSeconds,
    },
    motion: {
      enter: design.motion.enter,
      exit: design.motion.exit,
      typing: design.motion.typing,
      words: brief?.motion.words || null,
    },
    look: {
      kind: design.kind,
      colors: design.colors,
      cornerRadius: design.cornerRadius,
      tail: design.tail,
      font: design.font,
      receipt: design.receipt === true,
      avatar: design.avatar === true,
      words: brief?.look.words || null,
      platform: brief?.look.platform ?? null,
      shadow: brief?.look.shadow ?? null,
    },
    frames: reelMoments(appears, start, end, fps, seconds(template.duration)),
    confidence: design.confidence,
  };
}

/** The words' sample variable: the lead's words, with room for a made video's. */
export function wordsVariable(words: string): GraphicParam {
  return {
    type: 'text',
    name: 'text',
    maxLength: Math.min(500, Math.max(120, words.length * 4)),
    sample: words.slice(0, 500),
  };
}

/** The template's composition briefs: its graphic overlays by role, the longest on screen first in each. */
export function compositionBriefs(template: Template): CompositionBrief[] {
  const groups = new Map<GraphicBriefKind, OverlayBrief[]>();
  const length = new Map<string, number>();
  for (const overlay of graphicOverlays(template)) {
    const brief = overlayBrief(template, overlay);
    if (!brief) continue;
    length.set(overlay.id, seconds(overlay.duration));
    groups.set(brief.role, [...(groups.get(brief.role) ?? []), brief]);
  }
  const rate = template.canvas.rate;
  return [...groups.entries()].map(([role, overlays]) => {
    const ordered = [...overlays].sort((a, b) => length.get(b.overlayId)! - length.get(a.overlayId)!);
    return {
      role,
      canvas: { width: template.canvas.width, height: template.canvas.height },
      fps: rate.num / rate.den,
      overlays: ordered,
      system: template.graphics?.reading?.system ?? null,
      variables: [wordsVariable(ordered[0]!.words)],
    };
  });
}
