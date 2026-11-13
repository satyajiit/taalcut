// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { visibleTimelineFrame } from '../src/features/timeline/timeline-viewport';

describe('captured timeline scrubbing', () => {
  const viewport = { left: 100, width: 600, scrollLeft: 200 };

  it('stops at either visible edge even when the pointer leaves the timeline', () => {
    expect(visibleTimelineFrame(-100, viewport, 2, 1000)).toBe(104);
    expect(visibleTimelineFrame(1200, viewport, 2, 1000)).toBe(396);
  });

  it('accounts for horizontal scrolling and stops at the last video frame', () => {
    expect(visibleTimelineFrame(300, viewport, 2, 1000)).toBe(200);
    expect(visibleTimelineFrame(1200, viewport, 2, 300)).toBe(299);
    expect(visibleTimelineFrame(1200, viewport, 2, 0)).toBe(0);
    expect(visibleTimelineFrame(-100, { ...viewport, scrollLeft: 0 }, 2, 1000)).toBe(0);
  });

  it('keeps the complete handle visible after rounding at high zoom', () => {
    const unscrolled = { ...viewport, scrollLeft: 0 };
    const frame = visibleTimelineFrame(1200, unscrolled, 20, 1000);
    expect(frame).toBe(29);
    expect(frame * 20 + 7).toBeLessThanOrEqual(unscrolled.width);
    expect(visibleTimelineFrame(-100, unscrolled, 20, 1000)).toBe(0);
  });

  it.each([201, 213, 219])('bounds frames when scrollLeft=%s is between frame positions', (scrollLeft) => {
    const scrolled = { ...viewport, scrollLeft };
    const first = visibleTimelineFrame(-100, scrolled, 20, 1000);
    const last = visibleTimelineFrame(1200, scrolled, 20, 1000);
    expect(first * 20 - scrollLeft - 7).toBeGreaterThanOrEqual(0);
    expect(last * 20 - scrollLeft + 7).toBeLessThanOrEqual(scrolled.width);
    expect(visibleTimelineFrame(viewport.left + 200, scrolled, 20, 1000)).toBe(
      Math.round((scrollLeft + 200) / 20),
    );
  });
});
