// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-CTX, SPEC "Writing the slots a page at a time": the page size comes from the window, the largest page whose
 * measured worst case leaves PAGE_SPARE_TOKENS spare. The rule is held to the measured peaks
 * (test/fixtures/page-peaks.json, from `_orch/lrn1/logs/ctx/budget5/paged5.py`): it never counts a page smaller than
 * measured, and each measured window gets the page the measurements allow.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  fitPage,
  MAX_SLOT_PAGE,
  PAGE_MAX_BYTES,
  PAGE_PEAKS,
  PAGE_SPARE_TOKENS,
  pagePeak,
  slotPageFor,
  SMALLEST_WINDOW,
} from '../src/breakdown/slot-context-pages';

interface Measured {
  readonly k: number;
  readonly peak: number;
  readonly given: number;
}
const measured = (
  JSON.parse(readFileSync(new URL('./fixtures/page-peaks.json', import.meta.url), 'utf8')) as {
    peaks: Record<string, Measured[]>;
  }
).peaks;
const windows = Object.keys(measured).map(Number);

describe("templates.resolveCuts' page size", () => {
  it('is measured at every window the rule has a base for', () => {
    expect(windows).toEqual(PAGE_PEAKS.map((entry) => entry.window));
  });

  it('never counts a page smaller than measured', () => {
    for (const window of windows)
      for (const page of measured[String(window)] ?? [])
        expect(pagePeak(window, page.k), `${window}, ${page.k}`).toBeGreaterThanOrEqual(page.peak);
  });

  it('is the largest page whose worst case leaves the spare, at each measured window', () => {
    for (const window of windows) {
      const size = slotPageFor(window);
      expect(pagePeak(window, size) + PAGE_SPARE_TOKENS, `${window}`).toBeLessThanOrEqual(window);
      if (size < MAX_SLOT_PAGE)
        expect(pagePeak(window, size + 1) + PAGE_SPARE_TOKENS, `${window}`).toBeGreaterThan(window);
      // And the measured page of that size fits too.
      const page = measured[String(window)]?.find((item) => item.k === size);
      expect((page?.peak ?? 0) + PAGE_SPARE_TOKENS, `${window}`).toBeLessThanOrEqual(window);
    }
  });

  it('pins the pages the measurements give', () => {
    expect([8_192, 12_288, 16_384, 24_576, 32_768, 200_000].map(slotPageFor)).toEqual([
      2,
      6,
      10,
      17,
      MAX_SLOT_PAGE,
      MAX_SLOT_PAGE,
    ]);
    // An unknown window is the smallest a local tier runs (12,288); a window too small for a page still gets one slot.
    expect(slotPageFor(undefined)).toBe(slotPageFor(SMALLEST_WINDOW));
    expect(slotPageFor(undefined)).toBe(6);
    expect(slotPageFor(4_096)).toBe(1);
  });

  it('cuts a page short to the bytes a tool output keeps in the prompt', () => {
    const slot = (index: number) => ({ index, text: 'x'.repeat(1_000) });
    const render = (page: readonly { index: number; text: string }[]) => ({ slots: page });
    const page = fitPage(
      Array.from({ length: 20 }, (_, index) => slot(index)),
      render,
    );
    expect(page.length).toBe(8);
    expect(JSON.stringify(render(page)).length).toBeLessThanOrEqual(PAGE_MAX_BYTES);
    expect(fitPage([{ index: 0, text: 'x'.repeat(10_000) }], render)).toHaveLength(1);
  });
});
