// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a picture under a colour grade (MORE1) · system: DESIGN.md v0.7 (Footage
 *   First: a look is judged on the scene's own frame, never on a made-up swatch)
 * the scene's frame as a grade would leave it: the frame, through an SVG feColorMatrix with the grade's matrix
 *   (grade-matrix.ts, render's recipe restated). Used by a look's card, the colour sheet's chip and the Colour
 *   tile. Until the frame has loaded, three plain bands (sky, sand, leaf) take the grade instead
 * states: the frame · no frame yet (the bands) · as shot (no filter at all) · motion: none
 */
import type { Grade } from '@taalcut/core';
import { cn } from '@taalcut/ui';
import { useId } from 'react';
import { gradeFilterValues } from './grade-matrix';

export interface GradePictureProps {
  /** The scene's frame; null while it loads or when it has none. */
  still: string | null;
  /** The scene's grade to show; null or empty is the picture as shot. */
  grade: Partial<Grade> | null | undefined;
  /** The whole video's grade, drawn on top of the scene's. */
  videoGrade?: Partial<Grade> | null | undefined;
  className?: string;
}

const AS_SHOT = gradeFilterValues(null);

export function GradePicture({ still, grade, videoGrade, className }: GradePictureProps) {
  // A filter is found by its id: useId's colons are not valid in a url(#…) reference.
  const id = `grade${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const values = gradeFilterValues(grade, videoGrade);
  const filter = values === AS_SHOT ? undefined : { filter: `url(#${id})` };
  return (
    <span data-slot="grade-picture" className={cn('relative block overflow-hidden bg-viewer', className)}>
      {filter ? (
        <svg aria-hidden width="0" height="0" className="absolute">
          <filter id={id} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={values} />
          </filter>
        </svg>
      ) : null}
      {still ? (
        <img src={still} alt="" draggable={false} className="size-full object-cover" style={filter} />
      ) : (
        <span className="flex size-full" style={filter}>
          <span className="flex-1 bg-info" />
          <span className="flex-1 bg-warning" />
          <span className="flex-1 bg-success" />
        </span>
      )}
    </span>
  );
}
