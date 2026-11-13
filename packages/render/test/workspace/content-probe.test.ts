// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The page scripts that measure a composition's drawn content (HFW1 frames, QA's DOM probe) are one expression
 * each, and QA's probe reads composition clips by what they draw.
 */
import { describe, expect, it } from 'vitest';
import { DOM_PROBE } from '../../src/engine/dom-probe';
import { CONTENT_PROBE, lineCount, type ProbedContent } from '../../src/workspace/frames/content-probe';

describe('the content probes', () => {
  it('parse as expressions, and QA’s reads [data-tc-composition] by its drawn content', () => {
    for (const probe of [CONTENT_PROBE, DOM_PROBE])
      expect(() => new Function(`return ${probe};`)).not.toThrow();
    expect(DOM_PROBE).toContain("querySelectorAll('[data-tc-composition]')");
    expect(DOM_PROBE).toContain('compositionContent(clip)');
  });

  it('counts the lines words sit on: runs within half their size of a line share it', () => {
    const run = (top: number, sizePx = 54) => ({
      text: 'w',
      top,
      sizePx,
      colour: null,
      family: 'Poppins',
      backdrop: null,
    });
    const content = (texts: ProbedContent['texts']): ProbedContent => ({ id: 'c', box: null, texts });
    expect(lineCount(null)).toBe(0);
    expect(lineCount(content([]))).toBe(0);
    // A bold word and a smaller one beside it, a few px off the line's top.
    expect(lineCount(content([run(600), run(604, 40), run(598, 60)]))).toBe(1);
    expect(lineCount(content([run(665), run(600), run(730)]))).toBe(3);
  });
});
