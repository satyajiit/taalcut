// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MORE1: what the More tab's tiles and their surfaces say. Each tile names its value in words, so the same
 * sentences serve the tile, its surface's title line and what a screen reader hears. Pure: the caller's i18n.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { NEUTRAL_GRADE, VIDEO_SIZES, type Grade, type GradeLook, type VideoAspect } from '@taalcut/core';

/** A transition's name in words (also the bed's marks, transition-marks.tsx). */
export const TRANSITION_WORDS = {
  cut: msg({ id: 'editor.ops.transition.cut', message: 'A plain cut' }),
  dissolve: msg({ id: 'editor.ops.transition.dissolve', message: 'Crossfade' }),
  fade: msg({ id: 'editor.ops.transition.fade', message: 'Dip to black' }),
  flash: msg({ id: 'editor.ops.transition.flash', message: 'Flash of white' }),
  whip: msg({ id: 'editor.ops.transition.whip', message: 'Whip' }),
  zoom: msg({ id: 'editor.ops.transition.zoom', message: 'Zoom through' }),
  slide: msg({ id: 'editor.ops.transition.slide', message: 'Slide in' }),
} as const;

/** A colour look's name; `none` is the picture as it was shot. */
export const LOOK_WORDS: Readonly<Record<GradeLook | 'none', MessageDescriptor>> = {
  none: msg({ id: 'editor.ops.look.none', message: 'Colour as shot' }),
  vivid: msg({ id: 'editor.ops.look.vivid', message: 'Vivid' }),
  muted: msg({ id: 'editor.ops.look.muted', message: 'Soft colours' }),
  warm: msg({ id: 'editor.ops.look.warm', message: 'Warm' }),
  cool: msg({ id: 'editor.ops.look.cool', message: 'Cool' }),
  mono: msg({ id: 'editor.ops.look.mono', message: 'Black and white' }),
  vintage: msg({ id: 'editor.ops.look.vintage', message: 'Vintage' }),
  faded: msg({ id: 'editor.ops.look.faded', message: 'Faded' }),
  cinematic: msg({ id: 'editor.ops.look.cinematic', message: 'Cinematic' }),
};

/** "Normal speed", "Half speed", "2× speed". */
export function speedWords(i18n: I18n, speed: number): string {
  if (speed === 1) return i18n._(msg`Normal speed`);
  if (speed === 0.5) return i18n._(msg`Half speed`);
  const times = i18n.number(speed);
  return i18n._(msg`${times}× speed`);
}

/** The speed as a figure on its card: "0.5×". */
export function speedFigure(i18n: I18n, speed: number): string {
  const times = i18n.number(speed);
  return i18n._(msg`${times}×`);
}

/** The three adjustments the colour sheet offers, as the grade names them. */
export const GRADE_ADJUSTMENTS = ['exposure', 'temperature', 'saturation'] as const;
export type GradeAdjustment = (typeof GRADE_ADJUSTMENTS)[number];

/** Up to here a slider's change is "a little". */
const A_LITTLE = 0.3;

const ADJUSTED: Readonly<
  Record<GradeAdjustment, Readonly<Record<'up' | 'upLittle' | 'down' | 'downLittle', MessageDescriptor>>>
> = {
  exposure: {
    up: msg`Brighter`,
    upLittle: msg`A little brighter`,
    down: msg`Darker`,
    downLittle: msg`A little darker`,
  },
  temperature: {
    up: msg`Warmer`,
    upLittle: msg`A little warmer`,
    down: msg`Cooler`,
    downLittle: msg`A little cooler`,
  },
  saturation: {
    up: msg`More colour`,
    upLittle: msg`A little more colour`,
    down: msg`Less colour`,
    downLittle: msg`A little less colour`,
  },
};

/** One adjustment in words ("A little brighter"); null when it is as shot. */
export function adjustmentWords(i18n: I18n, key: GradeAdjustment, value: number): string | null {
  if (value === 0) return null;
  const little = Math.abs(value) <= A_LITTLE;
  return i18n._(ADJUSTED[key][value > 0 ? (little ? 'upLittle' : 'up') : little ? 'downLittle' : 'down']);
}

/** A scene's colour in words: its look, then what was adjusted. "As shot" when nothing was. */
export function gradeWords(i18n: I18n, grade: Partial<Grade> | undefined): string {
  const full: Grade = { ...NEUTRAL_GRADE, ...grade };
  const facts: string[] = [];
  if (full.look && full.lookStrength > 0) facts.push(i18n._(LOOK_WORDS[full.look]));
  for (const key of GRADE_ADJUSTMENTS) {
    const words = adjustmentWords(i18n, key, full[key]);
    if (words) facts.push(words);
  }
  // What this sheet has no slider for (the AI or a shared adjustment set it): said, not hidden.
  if (full.contrast !== 0 || full.tint !== 0 || (full.highlights ?? 0) !== 0 || (full.whites ?? 0) !== 0)
    facts.push(i18n._(msg`Fine-tuned`));
  return facts.length > 0 ? facts.join(' · ') : i18n._(msg`As shot`);
}

/** "For 2 seconds": how long a held moment lasts, under its name. Short, so the tile keeps to two lines. */
export function holdWords(i18n: I18n, seconds: number): string {
  return i18n._(
    msg({
      message: `For ${plural(seconds, { one: '# second', other: '# seconds' })}`,
      comment: 'Under "Held moment" on a tile: how long the held moment lasts',
    }),
  );
}

/** What each scene tile would do, said on a quiet tile when no scene is selected. */
export const SCENE_TILE_HINTS = {
  speed: msg`Slower or faster`,
  transition: msg`Into the next scene`,
  freeze: msg`Hold one moment`,
  colour: msg`Looks and light`,
  why: msg`Who picked it, and what was asked for`,
} as const;

/** How many covers the video has saved. */
export function coverWords(i18n: I18n, count: number): string {
  return count === 0
    ? i18n._(msg`None chosen yet`)
    : i18n._(msg`${plural(count, { one: '# cover saved', other: '# covers saved' })}`);
}

/** The video's shape as one of the sizes Taalcut makes; null for any other canvas. */
export function aspectOf(canvas: { readonly width: number; readonly height: number }): VideoAspect | null {
  const found = (Object.keys(VIDEO_SIZES) as VideoAspect[]).find((aspect) => {
    const size = VIDEO_SIZES[aspect];
    return size.width * canvas.height === size.height * canvas.width;
  });
  return found ?? null;
}

/** Where each size is posted, in a few words. */
export const SIZE_USES: Readonly<Record<VideoAspect, MessageDescriptor>> = {
  '9:16': msg`Reels, Shorts and TikTok`,
  '4:5': msg`Instagram feed posts`,
  '1:1': msg`Square posts and grids`,
  '16:9': msg`YouTube and wide screens`,
};
