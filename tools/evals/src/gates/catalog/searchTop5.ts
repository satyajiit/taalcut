// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  absentCell,
  DEFAULT_MIN_N,
  formatShare,
  oneCell,
  worstVerdict,
  type GateMetric,
  type LanguageSlice,
  type Measured,
} from '../gate-metric';
import { isPresent, type SearchLanguageRow } from '../inputs/types';
import { shareMeasured } from '../share';
import { LANGUAGE_NAMES } from '../slices';

const SLICES = ['overall', ...LANGUAGE_NAMES] as const;

function measured(row: SearchLanguageRow, language: string): Measured {
  const hits = row.hitAt5 * row.queries;
  const successes = Math.round(hits);
  // The report stores a rate, not a hit count. Wilson only when that rate is a real count.
  if (Math.abs(hits - successes) >= 1e-6) {
    return {
      value: row.hitAt5,
      n: row.queries,
      interval: null,
      detail: `${language} hit@5`,
      display: formatShare(row.hitAt5),
    };
  }
  const share = shareMeasured(successes, row.queries, `${language} hit@5`);
  share.value = row.hitAt5;
  share.display = formatShare(row.hitAt5);
  return share;
}

/** A missing language is missing input, not a hit rate of 0. So is a language with no queries. */
export const searchTop5: GateMetric = {
  id: 'searchTop5',
  label: 'Search top-5',
  source: 'eval',
  bindings: [
    {
      gate: 'v1',
      row: 3,
      cohort: 'all',
      minN: DEFAULT_MIN_N,
      target: { op: '>=', value: 0.8, unit: 'share' },
    },
  ],
  compute(inputs, binding) {
    if (!isPresent(inputs.evals) || inputs.evals.search === null) {
      return [absentCell(this, binding, 'search report absent')];
    }
    const report = inputs.evals.search;
    const cells = SLICES.map((language) => {
      const sliceLanguage: LanguageSlice = language === 'overall' ? 'all' : language;
      const slice = { cohort: 'all' as const, language: sliceLanguage };
      const row = report.rows.find((entry) => entry.language === language);
      const result: Measured =
        row === undefined || row.queries === 0
          ? {
              value: null,
              n: row === undefined ? null : 0,
              interval: null,
              detail: row === undefined ? `${language} absent` : `${language} has no queries`,
              display: 'no data',
              verdict: 'missing input',
            }
          : measured(row, language);
      return oneCell(this, binding, [report.source], report.source.synthetic, result, slice);
    });
    // v1 row 3 is "in all four languages": the deciding (overall) cell passes only when every language does.
    return cells.map((cell) =>
      cell.slice.language === 'all'
        ? {
            ...cell,
            verdict: worstVerdict(cells.map((each) => each.verdict)),
            detail: `${cell.detail}; the row needs every language at the bar`,
          }
        : cell,
    );
  },
};
