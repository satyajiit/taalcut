// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { clearTop, dodgeCaptions } from '../../src/reframe/caption-dodge';

const safe = { x: 120, y: 288, width: 540, height: 1300 };
const cue = (id: string, y: number, start = 0) => ({
  id,
  span: { start, end: start + 30 },
  box: { x: 200, y, width: 400, height: 120 },
});

describe('dodgeCaptions', () => {
  it('moves a cue below the face it would cover', () => {
    const face = { x: 300, y: 1000, width: 200, height: 220 };
    const moved = dodgeCaptions([cue('a', 1050)], () => [face], safe, 24);
    expect(moved.get('a')).toEqual({ topPx: 1000 + 220 + 24 });
  });

  it('moves it above when there is no room below', () => {
    const face = { x: 300, y: 1400, width: 200, height: 150 };
    const moved = dodgeCaptions([cue('a', 1420)], () => [face], safe, 24);
    expect(moved.get('a')).toEqual({ topPx: 1400 - 24 - 120 });
  });

  it('moves only the cues that overlap a face', () => {
    const face = { x: 300, y: 1000, width: 200, height: 200 };
    const moved = dodgeCaptions(
      [cue('over', 1080, 0), cue('clear', 1080, 60)],
      (span) => (span.start === 0 ? [face] : []),
      safe,
      24,
    );
    expect([...moved.keys()]).toEqual(['over']);
  });

  it('leaves a cue no place clears where it is', () => {
    const tall = { x: 100, y: 200, width: 700, height: 1500 };
    expect(dodgeCaptions([cue('a', 900)], () => [tall], safe, 24).size).toBe(0);
    expect(clearTop(cue('a', 900).box, [tall], safe, 24)).toBeNull();
  });

  it('clears every face once moved, not just the one it hit', () => {
    const faces = [
      { x: 300, y: 1000, width: 200, height: 200 },
      { x: 300, y: 1230, width: 200, height: 100 },
    ];
    const top = clearTop(cue('a', 1050).box, faces, safe, 24);
    expect(top).toBe(1000 - 24 - 120);
  });
});
