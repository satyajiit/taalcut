// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a composition's stills say about it (HFW1 frames), each with what to do about it for the model that made
 * it: `bounds` (its drawn content stays on the canvas while it shows), `typeFloor` (its words are as large as QA's
 * floor for graphics, by cap height at 1080) and `contrast` (words on a painted backdrop of the composition's own
 * contrast with it as QA asks; words straight on the picture are left to the vision judge and said so).
 */
import type { CompositionGateCheck } from '@taalcut/core';
import { fontMetrics } from '../../captions/fonts';
import { contrastRatio } from '../../qa/checks/captions';
import { GRAPHICS_THRESHOLDS } from '../../qa/checks/graphics';
import type { CaptionFontId } from '../../types';
import type { ProbedContent } from './content-probe';
import { impeccableFrameCheck } from './impeccable-check';

const CANVAS = { width: 1080, height: 1920 } as const;
const TOLERANCE = 2;

const at = (seconds: number | undefined) => `at ${(seconds ?? 0).toFixed(2)} s`;

export function frameChecks(
  contents: readonly (ProbedContent | null)[],
  seconds: readonly number[],
  fonts: readonly CaptionFontId[],
): CompositionGateCheck[] {
  // The smallest cap share among its fonts: the floor is judged by the font that draws smallest.
  const capShare = Math.min(
    ...(fonts.length ? fonts : (['notoSans'] as CaptionFontId[])).map((font) => fontMetrics(font).capHeight),
  );
  let outside = '';
  let smallest = Infinity;
  let smallestAt = '';
  let lowest = Infinity;
  let lowestAt = '';
  let onPicture = 0;
  contents.forEach((content, index) => {
    const box = content?.box;
    if (
      box &&
      !outside &&
      (box.x < -TOLERANCE ||
        box.y < -TOLERANCE ||
        box.x + box.width > CANVAS.width + TOLERANCE ||
        box.y + box.height > CANVAS.height + TOLERANCE)
    )
      outside = at(seconds[index]);
    for (const text of content?.texts ?? []) {
      const cap = text.sizePx * capShare;
      if (cap < smallest)
        [smallest, smallestAt] = [cap, `${at(seconds[index])}: "${text.text.slice(0, 20)}"`];
      if (!text.backdrop || !text.colour) {
        onPicture += 1;
        continue;
      }
      const ratio = contrastRatio(text.colour, text.backdrop);
      if (ratio < lowest)
        [lowest, lowestAt] = [ratio, `${at(seconds[index])}: ${text.colour} on ${text.backdrop}`];
    }
  });
  const floor = GRAPHICS_THRESHOLDS.minCapHeightPx;
  const minContrast = GRAPHICS_THRESHOLDS.minContrast;
  return [
    outside
      ? {
          id: 'bounds',
          status: 'fail',
          detail: `it draws past the canvas ${outside}. Keep it inside the 1080×1920 frame (max-width, wrapping) while it shows.`,
        }
      : { id: 'bounds', status: 'pass' },
    !Number.isFinite(smallest)
      ? { id: 'typeFloor', status: 'skipped', detail: 'no words were drawn in the stills' }
      : smallest + 0.01 >= floor
        ? { id: 'typeFloor', status: 'pass' }
        : {
            id: 'typeFloor',
            status: 'fail',
            detail: `cap height ${smallest.toFixed(1)} px under ${floor} ${smallestAt}. Make the words larger (font-size ${Math.ceil(floor / capShare)} px or more).`,
          },
    Number.isFinite(lowest) && lowest < minContrast
      ? {
          id: 'contrast',
          status: 'fail',
          detail: `${lowest.toFixed(2)}:1 under ${minContrast}:1 ${lowestAt}. Make the words or their backdrop lighter or darker.`,
        }
      : Number.isFinite(lowest)
        ? {
            id: 'contrast',
            status: 'pass',
            ...(onPicture ? { detail: `${onPicture} word runs on the picture, not measured` } : {}),
          }
        : {
            id: 'contrast',
            status: 'skipped',
            detail: 'the words sit on the picture; judge them in the stills',
          },
    impeccableFrameCheck(contents, seconds),
  ];
}
