// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A template overlay the reel drew as a shape (BRK1-GFX) is a graphic the AI designs (HFW1): when the template's use
 * names a composition that passed the gate, the made video draws the overlay with it, its words set to the new ones
 * and nothing measured (no size, no width: CSS lays them out), where the reel's shape sat, on the overlay's time (on
 * the reel's beat when it was within two frames of one). A graphic overlay with no composition is not drawn: there is
 * no built-in graphic to fall back to (HFW1 retire). An overlay with no design, plain text or a design read with
 * little confidence is a text item, and so is a designed one on too briefly for QA. Pure.
 */
import {
  isNotGraphic,
  RationalTime,
  type BeatMap,
  type GraphicAnchor,
  type GraphicComposition,
  type GraphicParamValues,
  type GraphicItem,
  type OverlayDesign,
  type Template,
  type TextOverlay,
  type TimelineItemId,
} from '@taalcut/core';
/** A design read with less confidence than this stays text: a wrong shape is worse than plain words. */
export const DESIGN_CONFIDENCE_FLOOR = 0.5;
/** QA's shortest graphic (render's graphicsReadability): an overlay on screen for less stays text. */
const MIN_SECONDS = 1;
/** The overlay moves onto a beat this close to it, in frames. */
const BEAT_SNAP_FRAMES = 2;

/**
 * HFW1: whether a reel overlay is a graphic the AI designs as a composition (a shape behind the words, a chat bubble
 * or a sticker, read with confidence), rather than words a text item shows.
 */
export function isGraphicOverlay(design: OverlayDesign | undefined): design is OverlayDesign {
  if (!design || design.confidence < DESIGN_CONFIDENCE_FLOOR) return false;
  if (design.kind === 'chatBubble' || design.kind === 'sticker') return true;
  return design.kind !== 'plain' && design.kind !== 'kineticTitle' && design.colors.fill !== null;
}

/** The frame nearest `frame` that is a beat, when one is within reach; else `frame`. */
export function onBeat(frame: number, beatMap: BeatMap | null, rate: Template['canvas']['rate']): number {
  if (!beatMap) return frame;
  let best = frame;
  let distance = BEAT_SNAP_FRAMES + 1;
  for (const beat of beatMap.beats) {
    const at = RationalTime.toFrames(beat, rate, 'round');
    const away = Math.abs(at - frame);
    if (away < distance) {
      best = at;
      distance = away;
    }
  }
  return distance <= BEAT_SNAP_FRAMES ? best : frame;
}

/**
 * HFW1: the template's composition for `overlay`: a use names one it holds that passed the gate, and the reading
 * doesn't call the overlay footage. Null otherwise.
 */
export function compositionUseFor(overlay: TextOverlay, template: Template) {
  const use = template.graphics?.uses.find(
    (candidate) => candidate.overlayId === overlay.id && candidate.compositionId !== undefined,
  );
  const composition = use
    ? template.graphics?.compositions?.find((candidate) => candidate.id === use.compositionId)
    : undefined;
  if (!use || !composition?.gate.passed || isNotGraphic(template.graphics, overlay.id)) return null;
  return { composition, params: use.params ?? {} };
}

/**
 * HFW1: a use's values with the made video's words in the composition's first text variable (where the reel's
 * words were). Nothing else is set: no size, no width; the composition's CSS lays the new words out.
 */
export function filledParams(
  composition: GraphicComposition,
  params: GraphicParamValues,
  words: string,
): GraphicParamValues {
  const text = composition.variables.find((variable) => variable.type === 'text');
  return text ? { ...params, [text.name]: words } : { ...params };
}

/** HFW1: the template's compositions the items draw with, once each: the timeline's own copies. */
export function compositionsUsed(
  template: Template,
  items: readonly { readonly composition: { readonly id: string; readonly hash: string } }[],
) {
  const named = new Set(items.map((item) => `${item.composition.id}@${item.composition.hash}`));
  return (template.graphics?.compositions ?? []).filter((copy) => named.has(`${copy.id}@${copy.hash}`));
}

/**
 * The composition graphic for `overlay` showing `text`, or null when it has none (`leftOut` says whether it is then
 * drawn at all). `rewritten` says whose words they are: the Editor's or the reel's.
 */
export function designedGraphic(
  overlay: TextOverlay,
  input: { readonly text: string; readonly rewritten: boolean; readonly template: Template },
  id: TimelineItemId,
): GraphicItem | null {
  const { template } = input;
  const designed = compositionUseFor(overlay, template);
  if (!designed && !isGraphicOverlay(overlay.design)) return null;
  const rate = template.canvas.rate;
  const first = RationalTime.toFrames(overlay.start, rate, 'round');
  const end = first + RationalTime.toFrames(overlay.duration, rate, 'round');
  const start = Math.min(onBeat(first, template.beatMap, rate), end - 1);
  if ((end - start) * (rate.den / rate.num) < MIN_SECONDS) return null;
  const slot = template.slots.find((candidate) => candidate.id === overlay.slotId);
  // On its slot's first frame it follows the slot when cuts move; anywhere else it keeps its time.
  const anchor: GraphicAnchor =
    slot && RationalTime.toFrames(slot.start, rate, 'round') === start
      ? { kind: 'slot', slotId: slot.id }
      : { kind: 'time', at: RationalTime.of(start, rate) };
  const common = {
    type: 'graphic' as const,
    id,
    anchor,
    start: RationalTime.of(start, rate),
    duration: RationalTime.of(end - start, rate),
    // Where the reel's sat; a composition lays itself out there with CSS, so this is never a size to draw at.
    placement: { box: overlay.design?.shape ?? overlay.box },
    styleKey: overlay.styleKey,
    language: overlay.language,
    origin: 'agent' as const,
    overlay: { id: overlay.id, words: input.rewritten ? ('editor' as const) : ('template' as const) },
  };
  // HFW1: the template's composition, its words set to the new ones.
  if (!designed) return null;
  const { composition, params } = designed;
  const textVariables = composition.variables.filter((variable) => variable.type === 'text');
  const preserveMultiText = textVariables.length > 1 && input.text.trim() === overlay.text.trim();
  return {
    ...common,
    composition: {
      id: composition.id,
      hash: composition.hash,
      params: preserveMultiText ? { ...params } : filledParams(composition, params, input.text),
    },
  };
}

/**
 * HFW1 retire: a graphic overlay its template has no composition for is left out of the made video, never drawn
 * with a built-in graphic or as bare words where the reel had a shape. The Designer designs it (template design).
 */
export function leftOut(overlay: TextOverlay, template: Template): boolean {
  return isGraphicOverlay(overlay.design) && compositionUseFor(overlay, template) === null;
}
