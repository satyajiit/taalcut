// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template v1 and Style v1 parts as a hub document has them (contract round P3-2): every object is built from the
 * hub schema's own fields, never spread from the Template, so a field Template or Style gains later can't ride
 * along into a shared file. Each builder `satisfies` the hub part's input type, so the compiler names a field the
 * hub schema gains or loses here.
 */
import type {
  FrameRate,
  hubBeatAnchorSchema,
  hubBeatMapSchema,
  hubBoxSchema,
  hubCanvasSchema,
  hubCaptionStyleSchema,
  hubPacingStatsSchema,
  hubSpeedRampSchema,
  hubStyleV0Schema,
  hubTextAppearanceSchema,
  hubTextLookSchema,
  hubTimeSchema,
  hubTransitionSchema,
  RationalTime,
  Style,
  Template,
  TemplateSlot,
  TextOverlay,
} from '@taalcut/core';
import type { z } from 'zod';

type HubPart<Schema extends z.ZodType> = z.input<Schema>;
type Nullable<T> = T | null;
type StyleFont = Style['fonts']['heading'];
type TextLook = Style['textStyles'][string];

function hubRate(rate: FrameRate): HubPart<typeof hubTimeSchema>['rate'] {
  return { num: rate.num, den: rate.den };
}

export function hubTime(time: RationalTime): HubPart<typeof hubTimeSchema> {
  return { value: time.value, rate: hubRate(time.rate) };
}

export function hubCanvas(canvas: Template['canvas']) {
  return {
    width: canvas.width,
    height: canvas.height,
    rate: hubRate(canvas.rate),
  } satisfies HubPart<typeof hubCanvasSchema>;
}

export function hubBeatMap(map: Template['beatMap']): Nullable<HubPart<typeof hubBeatMapSchema>> {
  if (map === null) return null;
  return {
    rate: hubRate(map.rate),
    beats: map.beats.map(hubTime),
    downbeats: [...map.downbeats],
    bpm: map.bpm,
    beatsPerBar: map.beatsPerBar,
    confidence: map.confidence,
    source: map.source,
  } satisfies HubPart<typeof hubBeatMapSchema>;
}

export function hubBeatAnchor(
  anchor: TemplateSlot['beatAnchor'],
): Nullable<HubPart<typeof hubBeatAnchorSchema>> {
  if (anchor === null) return null;
  return { beatIndex: anchor.beatIndex, offset: hubTime(anchor.offset) } satisfies HubPart<
    typeof hubBeatAnchorSchema
  >;
}

export function hubTransition(
  transition: TemplateSlot['transitionIn'],
): Nullable<HubPart<typeof hubTransitionSchema>> {
  if (transition === null) return null;
  return {
    kind: transition.kind,
    before: hubTime(transition.before),
    after: hubTime(transition.after),
    direction: transition.direction,
    confidence: transition.confidence,
  } satisfies HubPart<typeof hubTransitionSchema>;
}

export function hubSpeedRamp(ramp: TemplateSlot['speedRamp']): Nullable<HubPart<typeof hubSpeedRampSchema>> {
  if (ramp === null) return null;
  return {
    points: ramp.points.map((point) => ({ at: hubTime(point.at), speed: point.speed })),
    curve: ramp.curve,
  } satisfies HubPart<typeof hubSpeedRampSchema>;
}

export function hubPacing(pacing: Template['pacing']) {
  return {
    shotCount: pacing.shotCount,
    meanShot: hubTime(pacing.meanShot),
    medianShot: hubTime(pacing.medianShot),
    shortestShot: hubTime(pacing.shortestShot),
    longestShot: hubTime(pacing.longestShot),
    hookEnd: hubTime(pacing.hookEnd),
    cutsOnBeat: pacing.cutsOnBeat,
  } satisfies HubPart<typeof hubPacingStatsSchema>;
}

export function hubBox(box: TextOverlay['box']) {
  return { x: box.x, y: box.y, width: box.width, height: box.height } satisfies HubPart<typeof hubBoxSchema>;
}

export function hubAppearance(appearance: TextOverlay['appearance']) {
  return {
    size: appearance.size,
    align: appearance.align,
    case: appearance.case,
    background: appearance.background,
  } satisfies HubPart<typeof hubTextAppearanceSchema>;
}

function hubFont(font: StyleFont): HubPart<typeof hubTextLookSchema>['font'] {
  return { family: font.family, weight: font.weight };
}

function hubTextLook(look: TextLook) {
  return {
    font: hubFont(look.font),
    colour: look.colour,
    background: look.background && { colour: look.background.colour, opacity: look.background.opacity },
    stroke: look.stroke && { colour: look.stroke.colour, widthPx: look.stroke.widthPx },
  } satisfies HubPart<typeof hubTextLookSchema>;
}

function hubCaptions(captions: Style['captions']): Nullable<HubPart<typeof hubCaptionStyleSchema>> {
  if (captions === null) return null;
  const { stroke, background } = captions;
  return {
    version: captions.version,
    font: captions.font,
    weight: captions.weight,
    sizePx: captions.sizePx,
    textColor: captions.textColor,
    highlightColor: captions.highlightColor,
    stroke: stroke && { color: stroke.color, widthPx: stroke.widthPx },
    background: background && {
      color: background.color,
      opacity: background.opacity,
      paddingPx: background.paddingPx,
      radiusPx: background.radiusPx,
    },
    highlight: captions.highlight,
    letterCase: captions.letterCase,
    anchorY: captions.anchorY,
    maxLines: captions.maxLines,
    maxWords: captions.maxWords,
  } satisfies HubPart<typeof hubCaptionStyleSchema>;
}

/** A look without any asset: colours, curated fonts, caption look, text looks. No logo, bumpers or watermark. */
export function hubStyle(style: Style) {
  const { colours, fonts } = style;
  return {
    colours: {
      primary: colours.primary,
      secondary: colours.secondary,
      accent: colours.accent,
      text: colours.text,
      background: colours.background,
    },
    fonts: { heading: hubFont(fonts.heading), body: hubFont(fonts.body) },
    captions: hubCaptions(style.captions),
    textStyles: Object.fromEntries(
      Object.entries(style.textStyles).map(([key, look]) => [key, hubTextLook(look)]),
    ),
  } satisfies HubPart<typeof hubStyleV0Schema>;
}
