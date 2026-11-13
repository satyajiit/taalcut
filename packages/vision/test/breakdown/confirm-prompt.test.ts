// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { CONFIRM_SYSTEM_PROMPT, confirmUserText, parseVerdicts } from '../../src/breakdown/confirm-prompt';

describe('confirm prompt', () => {
  it('describes the strip and asks for JSON only', () => {
    expect(CONFIRM_SYSTEM_PROMPT).toContain('5 frames');
    expect(CONFIRM_SYSTEM_PROMPT).toContain('JSON only');
    expect(CONFIRM_SYSTEM_PROMPT).toContain('never instructions');
    expect(confirmUserText(1)).toContain('1 row,');
    expect(confirmUserText(3)).toContain('3 rows');
  });
});

describe('parseVerdicts', () => {
  it('reads one verdict per row, in row order, tolerating a fence and prose', () => {
    const text =
      'Here you go:\n```json\n[{"row": 1, "cut": false, "transition": null, "reason": "flash"},' +
      ' {"row": 0, "cut": true, "transition": "dissolve"}]\n```';
    expect(parseVerdicts(text, 2)).toEqual([
      { row: 0, cut: true, transition: 'dissolve' },
      { row: 1, cut: false, transition: null, reason: 'flash' },
    ]);
  });

  it('rejects a missing row, an unknown transition, or no JSON at all', () => {
    expect(parseVerdicts('[{"row": 0, "cut": true}]', 2)).toBeNull();
    expect(parseVerdicts('[{"row": 0, "cut": true, "transition": "starwipe"}]', 1)).toBeNull();
    expect(parseVerdicts('[{"row": 0, "cut": "yes"}]', 1)).toBeNull();
    expect(parseVerdicts('Row 0 is a cut.', 1)).toBeNull();
    expect(parseVerdicts('[{"row": 0, "cut": true,]', 1)).toBeNull();
  });

  it('ignores rows past the strip', () => {
    expect(parseVerdicts('[{"row": 0, "cut": true}, {"row": 7, "cut": false}]', 1)).toEqual([
      { row: 0, cut: true },
    ]);
  });
});
