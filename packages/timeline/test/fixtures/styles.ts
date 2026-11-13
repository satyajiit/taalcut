// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Looks for the P3-V16 tests: Styles (with or without a caption look) in a memory store that answers `get`, and a
 * caption track to put on a built timeline.
 */
import {
  CAPTION_PRESETS,
  err,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  STYLE_SCHEMA_VERSION,
  styleSchema,
  type CaptionStyle,
  type CaptionTrack,
  type Style,
  type StyleStore,
  type Timeline,
} from '@taalcut/core';

/** A look a Style may carry, unlike every preset (so a test can tell the two apart). */
export const BRAND_CAPTIONS: CaptionStyle = {
  ...CAPTION_PRESETS.classic,
  font: 'montserrat',
  textColor: '#fff5e0',
  highlightColor: '#ff8800',
};

export function makeStyle(captions: CaptionStyle | null, name = 'Goa kit'): Style {
  const heading = { family: 'poppins' as const, weight: 700 };
  return styleSchema.parse({
    schemaVersion: STYLE_SCHEMA_VERSION,
    id: newId<'Style'>(),
    revision: 1,
    name,
    kind: 'brandKit',
    colours: {
      primary: '#112233',
      secondary: '#445566',
      accent: '#ff8800',
      text: '#ffffff',
      background: '#000000',
    },
    fonts: { heading, body: { family: 'notoSans', weight: 400 } },
    captions,
    textStyles: { title: { font: heading, colour: '#ffffff', background: null, stroke: null } },
    logo: null,
    watermark: null,
    intro: null,
    outro: null,
    grade: null,
    fontMatch: null,
    madeFrom: null,
    createdAt: 0,
    updatedAt: 0,
  });
}

/** `get` over the given Styles; any other id is core.not_found, as the library's store answers. */
export function memoryStyles(styles: readonly Style[]): Pick<StyleStore, 'get'> {
  const byId = new Map(styles.map((style) => [style.id as string, style]));
  return {
    async get(styleId) {
      const found = byId.get(styleId);
      return found ? ok(found) : err(NotFoundError({ entity: 'style', id: styleId }));
    },
  };
}

/** The timeline with one caption cue over its first second, in the minimal preset's look. */
export function withCaptions(timeline: Timeline): Timeline {
  const rate = timeline.canvas.rate;
  const at = (value: number) => RationalTime.of(value, rate);
  const captions: CaptionTrack = {
    enabled: true,
    language: 'en',
    style: CAPTION_PRESETS.minimal,
    styleSource: 'preset',
    cues: [
      {
        id: newId<'CaptionCue'>(),
        range: { start: at(0), duration: at(20) },
        words: [
          { text: 'hello', range: { start: at(0), duration: at(10) }, confidence: 1 },
          { text: 'there', range: { start: at(10), duration: at(10) }, confidence: 1 },
        ],
        edited: false,
      },
    ],
  };
  return { ...timeline, captions };
}
