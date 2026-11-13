// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the visuals' colour grades in the composition. Each distinct grade chain is one SVG filter (matrices
 * and optional highlight curves on gamma-encoded sRGB) in a hidden <svg>; a graded visual (and its blurred pad) sits in a
 * wrapper drawn through it, so the visual's own filter tracks (a whip's blur) and opacity still animate under the
 * grade. A composition without grades has none of this, so its markup and hash are unchanged.
 */
import { isNeutralGrade } from '@taalcut/core';
import { feColorMatrixValues, gradeMatrix, visualGradeMatrix } from '../../grade/clip-grade';
import { highlightTable } from '../../grade/highlight-curve';
import type { PlannedVisual } from '../../plan/types';
import { element } from '../html';

/** A filter's id: letters only, so no style parser reads part of it as a number. */
function letters(index: number): string {
  let out = '';
  let rest = index;
  do {
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26) - 1;
  } while (rest >= 0);
  return `tcgrade${out}`;
}

export interface GradeFilters {
  /** The wrapper's filter id for a visual; undefined when it has no grade. */
  readonly filterOf: (visual: PlannedVisual) => string | undefined;
  /** The hidden <svg> with every filter; '' when nothing is graded. */
  readonly markup: string;
}

function filterBody(visual: PlannedVisual): string | null {
  const grades = (visual.grades ?? []).filter((grade) => !isNeutralGrade(grade));
  if (!grades.some((grade) => highlightTable(grade) !== null)) {
    const matrix = visualGradeMatrix(grades);
    return matrix
      ? element('feColorMatrix', { type: 'matrix', values: feColorMatrixValues(matrix) }, '', false)
      : null;
  }
  // Curves are nonlinear: keep each clip/video grade in its original order instead of merging their matrices.
  return grades
    .map((grade) => {
      const matrix = element(
        'feColorMatrix',
        { type: 'matrix', values: feColorMatrixValues(gradeMatrix(grade)) },
        '',
        false,
      );
      const table = highlightTable(grade);
      return (
        matrix +
        (table === null
          ? ''
          : element(
              'feComponentTransfer',
              {},
              ['R', 'G', 'B']
                .map((channel) =>
                  element(`feFunc${channel}`, { type: 'table', tablevalues: table }, '', false),
                )
                .join(''),
            ))
      );
    })
    .join('');
}

export function gradeFilters(visuals: readonly PlannedVisual[]): GradeFilters {
  const byValues = new Map<string, string>();
  const ofVisual = new Map<string, string>();
  for (const visual of visuals) {
    const values = filterBody(visual);
    if (!values) continue;
    const id = byValues.get(values) ?? letters(byValues.size);
    byValues.set(values, id);
    ofVisual.set(visual.id, id);
  }
  const filters = [...byValues].map(([values, id]) =>
    element(
      'filter',
      { id, 'color-interpolation-filters': 'sRGB', x: '0', y: '0', width: '1', height: '1' },
      values,
    ),
  );
  return {
    filterOf: (visual) => ofVisual.get(visual.id),
    markup:
      filters.length === 0
        ? ''
        : element(
            'svg',
            { class: 'tc-grades', width: '0', height: '0', 'aria-hidden': 'true', focusable: 'false' },
            element('defs', {}, filters.join('')),
          ),
  };
}

/** The wrapper of a graded visual: its id and the CSS that draws it through its filter at the visual's place. */
export function gradeWrapper(
  visualId: string,
  filterId: string,
  z: number,
  size: { width: number; height: number },
) {
  const id = `gw-${visualId}`;
  return {
    open: `<div id="${id}" class="tc-graded">`,
    close: '</div>',
    css: `#${id} { position: absolute; left: 0; top: 0; width: ${size.width}px; height: ${size.height}px; z-index: ${z}; filter: url(#${filterId}); }`,
  };
}
