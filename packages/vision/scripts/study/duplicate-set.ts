// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The labelled near-duplicate set for the duplicate-threshold study (IX2-E2), generated with FFmpeg from the
 * budget study's subject photos (scripts/study/user-pictures.json):
 *
 * - `base`: the photo cropped to 16:9, filling a 1920×1080 frame (a phone shot);
 * - true duplicates of `base` (the same moment): `jpeg` (re-encoded at JPEG quality ~20), `resize` (down to 480×270
 *   and back up), `pan` (the crop moved 3% right: a burst with camera motion), `bright` (levels stretched by 1/0.85:
 *   brighter, highlights clipped), `blur` (Gaussian, sigma 4: the same moment taken worse) and `grain` (sensor noise);
 * - `scene`: the whole photo at 480×480 on a fixed grey 1920×1080 frame at a fixed place (the same "location" for every
 *   subject), and `scene-pan`, the same scene moved by 2% (a duplicate);
 * - `zoom`: the centre half of the photo filling the frame (a close-up of the same subject: another shot, not a
 *   duplicate).
 *
 * Pairs: each subject's `base` with each of its six variants and `scene` with `scene-pan` are duplicates; `base` with
 * `zoom`, every subject's `scene` with the next two subjects' `scene` (same place, different content) and `base` with
 * the two most similar other subjects' `base` (the hard negatives, picked by the study at its first budget) are not.
 */
import type { MediaContext } from '@taalcut/media';
import { renderPhotos, type SubjectPhoto } from './framings';

export const VARIANTS = [
  'base',
  'jpeg',
  'resize',
  'pan',
  'bright',
  'blur',
  'grain',
  'scene',
  'scene-pan',
  'zoom',
] as const;
export type Variant = (typeof VARIANTS)[number];

/** Variants that are the same moment as `base`. */
export const DUPLICATES_OF_BASE: readonly Variant[] = ['jpeg', 'resize', 'pan', 'bright', 'blur', 'grain'];

export interface VariantImage {
  readonly subject: string;
  readonly variant: Variant;
  readonly path: string;
}

export interface LabelledPair {
  readonly a: VariantImage;
  readonly b: VariantImage;
  readonly duplicate: boolean;
  readonly kind: string;
}

const WIDE = 'crop=iw:iw*9/16';
const FRAME = 'scale=1920:1080,setsar=1';

function filterFor(variant: Variant): { readonly filter: string; readonly background: boolean } {
  switch (variant) {
    case 'base':
      return { filter: `${WIDE},${FRAME}`, background: false };
    case 'jpeg':
    case 'grain':
      return {
        filter: `${WIDE},${FRAME}${variant === 'grain' ? ',noise=alls=18:allf=t' : ''}`,
        background: false,
      };
    case 'resize':
      return { filter: `${WIDE},scale=480:270,${FRAME}`, background: false };
    case 'pan':
      return { filter: `crop=iw*0.97:iw*0.97*9/16:iw*0.03:(ih-iw*0.97*9/16)/2,${FRAME}`, background: false };
    case 'bright':
      return { filter: `${WIDE},${FRAME},colorlevels=rimax=0.85:gimax=0.85:bimax=0.85`, background: false };
    case 'blur':
      return { filter: `${WIDE},${FRAME},gblur=sigma=4`, background: false };
    case 'zoom':
      return { filter: `crop=iw/2:iw/2*9/16,${FRAME}`, background: false };
    case 'scene':
      return { filter: 'scale=480:480', background: true };
    case 'scene-pan':
      return { filter: 'scale=480:480', background: true };
  }
}

function args(photo: string, variant: Variant, out: string): string[] {
  const head = ['-y', '-hide_banner', '-loglevel', 'error'];
  const { filter, background } = filterFor(variant);
  if (background) {
    const x = variant === 'scene-pan' ? 760 + 38 : 760;
    return [
      ...head,
      ...['-f', 'lavfi', '-i', 'color=c=0x6a7078:s=1920x1080', '-i', photo],
      ...['-filter_complex', `[1]${filter},format=rgb24[s];[0][s]overlay=x=${x}:y=300`],
      ...['-frames:v', '1', '-update', '1', out],
    ];
  }
  const quality = variant === 'jpeg' ? ['-q:v', '24'] : [];
  return [...head, '-i', photo, '-vf', filter, ...quality, '-frames:v', '1', '-update', '1', out];
}

/** Writes every subject's variants into `dir` (PNG, the `jpeg` variant as JPEG). */
export async function writeVariants(
  media: MediaContext,
  photos: readonly SubjectPhoto[],
  dir: string,
): Promise<VariantImage[]> {
  const extension = (variant: Variant) => (variant === 'jpeg' ? 'jpg' : 'png');
  const rendered = await renderPhotos(media, photos, VARIANTS, { dir, extension, args });
  return rendered.map(({ subject, kind, path }) => ({ subject, variant: kind, path }));
}

/**
 * The labelled pairs. `similarBases(subject)` names the two other subjects whose `base` is closest to this one's
 * (the hard negatives).
 */
export function labelledPairs(
  images: readonly VariantImage[],
  similarBases: (subject: string) => readonly string[],
): LabelledPair[] {
  const find = (subject: string, variant: Variant) =>
    images.find((i) => i.subject === subject && i.variant === variant);
  const subjects = [...new Set(images.map((i) => i.subject))];
  const pairs: LabelledPair[] = [];
  const seen = new Set<string>();
  const add = (
    a: VariantImage | undefined,
    b: VariantImage | undefined,
    duplicate: boolean,
    kind: string,
  ) => {
    if (a && b) pairs.push({ a, b, duplicate, kind });
  };
  subjects.forEach((subject, n) => {
    const base = find(subject, 'base');
    for (const variant of DUPLICATES_OF_BASE) add(base, find(subject, variant), true, variant);
    add(find(subject, 'scene'), find(subject, 'scene-pan'), true, 'scene-pan');
    add(base, find(subject, 'zoom'), false, 'zoom');
    for (const step of [1, 2]) {
      const other = subjects[(n + step) % subjects.length];
      if (other) add(find(subject, 'scene'), find(other, 'scene'), false, 'same-place');
    }
    for (const other of similarBases(subject)) {
      const key = [subject, other].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      add(base, find(other, 'base'), false, 'similar-subject');
    }
  });
  return pairs;
}
