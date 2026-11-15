// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: what `timeline.textLook` answers. For each text role a video uses: how many texts carry it, the look they
 * have now, and how the reference set that role's letters, as the breakdown measured it from the reel's pixels
 * (colour, weight, outline, shadow, how wide the letters are set, case, how they come on), each with the
 * measure's confidence. The numbers are turned into the units a look is stated in (an outline in pixels of this
 * video), nothing more: which face and which look to use is the model's to state, never chosen here. Pure.
 */
import {
  readableTextSize,
  textRolesOf,
  undesignedTextRoles,
  unplacedTexts,
  type AsyncResult,
  type Style,
  type StyleId,
  type Template,
  type TextItem,
  type TextLook,
  type TextOverlay,
  type Timeline,
} from '@taalcut/core';
import type { TemplateReader } from '../service/templates';

/** Reads the Style a video names. */
export type TextStyleReader = (styleId: StyleId) => AsyncResult<Style>;

export interface TextStyleDeps {
  readonly templates?: TemplateReader;
  readonly textStyle?: TextStyleReader;
}

/** A video's template, when it follows one that can be read. */
export async function templateOf(timeline: Timeline, deps: TextStyleDeps): Promise<Template | null> {
  if (!timeline.template || !deps.templates) return null;
  const template = await deps.templates.read(timeline.template);
  return template.ok ? template.value : null;
}

/**
 * The Style a video's text is drawn with, as a render resolves it: the video's own, else its template's; null for
 * none, or one that is gone. Undefined when no Style can be read here at all.
 */
export async function textStyleOf(
  timeline: Timeline,
  deps: TextStyleDeps,
  template?: Template | null,
): Promise<Style | null | undefined> {
  if (!deps.textStyle) return undefined;
  const from = template === undefined ? await templateOf(timeline, deps) : template;
  const styleId = timeline.styleId ?? from?.styleId ?? null;
  if (!styleId) return null;
  const found = await deps.textStyle(styleId);
  return found.ok ? found.value : null;
}

/**
 * What `timeline.get` tells a make while the video's text has no designed look, or no stated place: what is
 * missing, and the tools that state it (the make's finish holds the video otherwise, a draft later). Undefined
 * when every role has a look and every text a place, the video has no text, or no Style can be read here.
 */
export async function textLookHint(timeline: Timeline, deps: TextStyleDeps): Promise<string | undefined> {
  if (textRolesOf(timeline).length === 0) return undefined;
  const style = await textStyleOf(timeline, deps);
  if (style === undefined) return undefined;
  const roles = undesignedTextRoles(timeline, style).map((use) => use.role);
  const unplaced = unplacedTexts(timeline).length;
  if (roles.length === 0 && unplaced === 0) return undefined;
  const look = roles.length > 0 ? `No designed look yet for the text (${roles.join(', ')}).` : '';
  const place = unplaced > 0 ? `No stated place or size yet for ${unplaced} of its texts.` : '';
  const tools = [
    ...(roles.length > 0 ? ['timeline.designText'] : []),
    ...(unplaced > 0 ? ['timeline.placeText'] : []),
  ];
  return [look, place, `Before render.draft: timeline.textLook, then ${tools.join(' and ')}.`]
    .filter((part) => part !== '')
    .join(' ');
}

/** One bundled face, as the tool lists it: what it is called, its class, the weights its files draw. */
export interface TextFace {
  readonly id: string;
  readonly family: string;
  readonly class: string;
  /** The lightest and heaviest weight it draws (the same for a face of one weight). */
  readonly weights: readonly [number, number];
}

/** How the reference set one role's letters, measured. */
export interface ReelLook {
  /** How many of the role's texts the breakdown measured, of how many the reference had. */
  readonly measured: number;
  readonly of: number;
  /**
   * How many of those had their letters measured (TXT1's `design.type`). 0 for a reference broken down before
   * that: its outline, shadow and width are then unknown, not none.
   */
  readonly lettersMeasured: number;
  readonly colour: string;
  readonly weight: number;
  /** The pixels' guess at the kind of face; an eye is surer (look at a frame of the reference). */
  readonly class: string;
  readonly outline: { readonly colour: string | null; readonly widthPx: number } | null;
  readonly shadow: boolean | null;
  readonly width: string | null;
  /** The gap between letters over their height; null when unread. */
  readonly spacing: number | null;
  readonly box: { readonly colour: string } | null;
  readonly case: string;
  readonly arrives: string;
  readonly confidence: number;
}

export interface RoleLook {
  readonly role: string;
  readonly texts: number;
  readonly example: string;
  readonly itemIds: readonly string[];
  readonly look: TextLook | null;
  readonly reel: ReelLook | null;
}

const itemsOf = (timeline: Pick<Timeline, 'tracks'>): TextItem[] =>
  timeline.tracks.flatMap((track) =>
    track.kind === 'text' ? track.items.filter((item): item is TextItem => item.type === 'text') : [],
  );

const sureness = (overlay: TextOverlay) =>
  overlay.design?.type?.confidence ?? overlay.design?.confidence ?? 0;

/** The value most of the weight stands behind (the first of them on a tie). */
function most<T>(votes: readonly (readonly [T, number])[]): T | undefined {
  const sums = new Map<T, number>();
  for (const [value, weight] of votes) sums.set(value, (sums.get(value) ?? 0) + weight);
  let best: T | undefined;
  for (const [value, sum] of sums) if (best === undefined || sum > sums.get(best)!) best = value;
  return best;
}

const middle = (values: readonly number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];

const rgbOf = (colour: string) => [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16));
const apart = (a: string, b: string) => {
  const [x, y] = [rgbOf(a), rgbOf(b)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
};
/** The colour nearest all the others, by weight: one misread colour among several doesn't move it. */
function central(votes: readonly (readonly [string, number])[]): string | undefined {
  let best: string | undefined;
  let least = Infinity;
  for (const [colour] of votes) {
    const far = votes.reduce((sum, [other, weight]) => sum + weight * apart(colour, other), 0);
    if (far < least) [best, least] = [colour, far];
  }
  return best;
}

/**
 * The measured look of a role's overlays. One reading can be wrong (a still picture under the words, letters that
 * touch), so the role's overlays vote, each by how sure its reading is: the colour nearest the others, the middle
 * weight, an outline, a shadow and a box when most have one, the width most claim. With one overlay it is its own.
 */
export function reelLookOf(overlays: readonly TextOverlay[], capPx: number): ReelLook | null {
  const measured = overlays.flatMap((overlay) =>
    overlay.design ? [{ overlay, design: overlay.design, sure: Math.max(sureness(overlay), 0.01) }] : [],
  );
  if (measured.length === 0) return null;
  const typed = measured.flatMap((entry) =>
    entry.design.type ? [{ ...entry, type: entry.design.type }] : [],
  );
  const outlined = typed.filter((entry) => entry.type.outline !== null);
  const hasOutline = most(typed.map((entry) => [entry.type.outline !== null, entry.sure] as const)) === true;
  const strokes = outlined.flatMap((entry) =>
    entry.design.colors.stroke ? [[entry.design.colors.stroke, entry.sure] as const] : [],
  );
  const boxed = measured.filter((entry) => entry.design.colors.fill !== null);
  const hasBox =
    most(measured.map((entry) => [entry.design.colors.fill !== null, entry.sure] as const)) === true;
  const widths = typed.flatMap((entry) =>
    entry.type.width ? [[entry.type.width, entry.sure] as const] : [],
  );
  const spacings = typed.flatMap((entry) => (entry.type.spacing !== null ? [entry.type.spacing] : []));
  const weight = middle(measured.map((entry) => entry.design.font.weight)) ?? 400;
  const sures = measured.map((entry) => entry.sure);
  return {
    measured: measured.length,
    of: overlays.length,
    lettersMeasured: typed.length,
    colour: central(measured.map((entry) => [entry.design.colors.text, entry.sure] as const))!,
    weight: Math.min(900, Math.max(100, Math.round(weight / 100) * 100)),
    class: most(measured.map((entry) => [entry.design.font.class, entry.sure] as const))!,
    // An outline's width comes as a share of the letters' height; a look states it in pixels of the video.
    outline: hasOutline
      ? {
          colour: central(strokes) ?? null,
          widthPx: Math.min(
            16,
            Math.max(1, Math.round(middle(outlined.map((entry) => entry.type.outline!))! * capPx)),
          ),
        }
      : null,
    shadow: typed.length > 0 ? most(typed.map((entry) => [entry.type.shadow, entry.sure] as const))! : null,
    width: most(widths) ?? null,
    spacing: middle(spacings) ?? null,
    box: hasBox
      ? { colour: central(boxed.map((entry) => [entry.design.colors.fill!, entry.sure] as const))! }
      : null,
    case: most(measured.map((entry) => [entry.overlay.appearance.case, entry.sure] as const))!,
    arrives: most(measured.map((entry) => [entry.overlay.reveal, entry.sure] as const))!,
    confidence: Math.round((sures.reduce((sum, sure) => sum + sure, 0) / sures.length) * 100) / 100,
  };
}

/** Every text role of the video, with its look now and the reference's measured look. */
export function roleLooks(
  timeline: Timeline,
  style: Pick<Style, 'textStyles'> | null,
  template: Pick<Template, 'text'> | null,
): RoleLook[] {
  const items = new Map(itemsOf(timeline).map((item) => [item.id as string, item]));
  const overlays = new Map((template?.text ?? []).map((overlay) => [overlay.id as string, overlay]));
  return textRolesOf(timeline).map((use) => {
    const texts = use.itemIds.flatMap((id) => items.get(id) ?? []);
    const sources = texts.flatMap((item) => (item.overlayId ? (overlays.get(item.overlayId) ?? []) : []));
    const sizes = texts.map((item) => item.appearance.size).sort((a, b) => a - b);
    const capPx =
      (sizes[Math.floor(sizes.length / 2)] ?? readableTextSize(timeline.canvas)) * timeline.canvas.height;
    return {
      role: use.role,
      texts: texts.length,
      example: (texts[0]?.text ?? '').slice(0, 60),
      itemIds: use.itemIds.slice(0, 12),
      look: style?.textStyles[use.role] ?? null,
      reel: reelLookOf(sources, capPx),
    };
  });
}

/** What a face of this id can't draw, as words: the weight asked for against the weights it has. */
export function weightRefusal(faces: readonly TextFace[], family: string, weight: number): string | null {
  const face = faces.find((candidate) => candidate.id === family);
  if (!face) return null;
  const [low, high] = face.weights;
  if (weight >= low && weight <= high) return null;
  const has = low === high ? `only weight ${low}` : `weights ${low} to ${high}`;
  const others = faces
    .filter(
      (candidate) =>
        candidate.class === face.class && weight >= candidate.weights[0] && weight <= candidate.weights[1],
    )
    .map((candidate) => candidate.id);
  return (
    `${face.family} (${family}) has ${has}, not ${weight}. Give a weight it has` +
    (others.length > 0 ? `, or a ${face.class} face that draws ${weight}: ${others.join(', ')}.` : '.')
  );
}
