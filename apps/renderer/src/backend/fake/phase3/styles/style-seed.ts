// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- the person's kit names, card words and handles: data, never translated */

/**
 * The fake's brand kits and looks (P3-V10): two brand kits, "Chai & Co." (the default for new videos, with a
 * logo, a caption look and an intro and outro card) and "Monsoon Travels" (a text watermark, no logo), and one
 * look, "Warm film", measured from the Golden hour template (a grade and a matched font). Each parses with
 * core's styleSchema (test/brand-fake-styles.test.ts).
 */
import { CAPTION_PRESETS, FrameRates, RationalTime, type Style, type StyleId } from '@taalcut/core';
import { FIXTURE_NOW } from '../../library/assets';
import { fakeUlid } from '../../library/seed';
import { GOLDEN_HOUR, templateIdOf } from '../../templates/template-data';

const DAY = 24 * 60 * 60 * 1000;
/** Kinds 0–31 of fakeUlid: the library uses 1–4, templates 5–9, Make 20–29; styles take 31. */
const STYLE_KIND = 31;

export const STYLE_IDS = {
  chai: fakeUlid<'Style'>(STYLE_KIND, 1),
  monsoon: fakeUlid<'Style'>(STYLE_KIND, 2),
  /** The look the kit's styleBatch fixture names (packages/ui fixtures-looks.ts). */
  warmFilm: '01K7C5M6Q8R9S0T1V2W3X4Y5ZR' as StyleId,
} as const;

/** sha256 of the seeded logo's bytes (the fake never stores the image itself). */
export const SEEDED_LOGO_SHA = '6c1d3f5a9e2b7c4d8f0a1b3c5d7e9f20416283a5c7e9fb1d3f5a7c9e0b2d4f68';

const seconds = (n: number) => RationalTime.fromSeconds(n, FrameRates.milliseconds);
const golden = { templateId: templateIdOf(GOLDEN_HOUR), version: 2 };

function base(id: StyleId, daysAgo: number) {
  const at = FIXTURE_NOW - daysAgo * DAY;
  return {
    schemaVersion: 1 as const,
    id,
    revision: 1,
    textStyles: {},
    grade: null,
    fontMatch: null,
    madeFrom: null,
    createdAt: at,
    updatedAt: at,
  };
}

export function seededStyles(): Style[] {
  const chai: Style = {
    ...base(STYLE_IDS.chai, 6),
    name: 'Chai & Co.',
    kind: 'brandKit',
    colours: {
      primary: '#c2410c',
      secondary: '#fde68a',
      accent: '#0f766e',
      text: '#1c1917',
      background: '#fff7ed',
    },
    fonts: { heading: { family: 'poppins', weight: 700 }, body: { family: 'notoSans', weight: 400 } },
    captions: { ...CAPTION_PRESETS.classic, highlightColor: '#fde68a' },
    logo: {
      asset: SEEDED_LOGO_SHA,
      mediaType: 'image/png',
      width: 512,
      height: 512,
      placement: 'topRight',
      scale: 0.14,
      opacity: 0.9,
      showOn: 'always',
    },
    watermark: null,
    intro: { kind: 'card', text: 'Chai & Co.', duration: seconds(2), background: 'primary' },
    outro: { kind: 'card', text: 'Follow for more', duration: seconds(2), background: 'secondary' },
  };
  const monsoon: Style = {
    ...base(STYLE_IDS.monsoon, 3),
    name: 'Monsoon Travels',
    kind: 'brandKit',
    colours: {
      primary: '#1d4ed8',
      secondary: '#bfdbfe',
      accent: '#f59e0b',
      text: '#f8fafc',
      background: '#0f172a',
    },
    fonts: { heading: { family: 'bebasNeue', weight: 400 }, body: { family: 'mukta', weight: 400 } },
    captions: null,
    logo: null,
    watermark: { kind: 'text', text: '@monsoontravels', placement: 'bottomRight', opacity: 0.4 },
    intro: null,
    outro: null,
  };
  const warmFilm: Style = {
    ...base(STYLE_IDS.warmFilm, 1),
    name: 'Warm film',
    kind: 'look',
    colours: {
      primary: '#b45309',
      secondary: '#fcd34d',
      accent: '#9f1239',
      text: '#fffbeb',
      background: '#292524',
    },
    fonts: { heading: { family: 'notoSans', weight: 700 }, body: { family: 'notoSans', weight: 400 } },
    captions: { ...CAPTION_PRESETS.minimal, font: 'notoSans' },
    logo: null,
    watermark: null,
    intro: null,
    outro: null,
    grade: {
      version: 1,
      target: {
        version: 1,
        space: 'ruderman-lab',
        encoding: 'bt709',
        mean: [-0.42, 0.031, 0.018],
        std: [0.21, 0.044, 0.052],
        frames: 12,
        pixels: 2_488_320,
      },
      strength: 0.7,
      cubeSize: 33,
      source: { kind: 'template', ...golden },
      measuredAt: FIXTURE_NOW - DAY,
    },
    // Inter is the honest winner; captions can't draw it, so they use the best caption font (§11).
    fontMatch: {
      version: 1,
      family: 'inter',
      captionFont: 'notoSans',
      score: 0.82,
      metric: 'ssim',
      script: 'latin',
      ranking: [
        { family: 'inter', score: 0.82 },
        { family: 'notoSans', score: 0.76 },
        { family: 'montserrat', score: 0.61 },
      ],
      sampleText: 'GOLDEN HOUR',
      ocrConfidence: 0.91,
    },
    madeFrom: golden,
  };
  return [chai, monsoon, warmFilm];
}
