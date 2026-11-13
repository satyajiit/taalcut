// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B9: release notes are data. `- ` bullets and `**bold**` are the only marks; everything else is text.
import { describe, expect, it } from 'vitest';
import { parseReleaseNotes, parseRuns } from '../../src/features/updates/release-notes-parse';

describe('release notes', () => {
  it('reads bullets as one list and bold as runs', () => {
    expect(parseReleaseNotes('- **Starter templates**: a first video.\n- Cable import.')).toEqual([
      {
        kind: 'list',
        items: [
          [
            { text: 'Starter templates', bold: true },
            { text: ': a first video.', bold: false },
          ],
          [{ text: 'Cable import.', bold: false }],
        ],
      },
    ]);
  });

  it('keeps paragraphs apart from lists, joins wrapped lines, and splits on blank lines', () => {
    const blocks = parseReleaseNotes('What changed\nthis week.\n\n- One\n- Two\n\nThanks.\r\n');
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'list', 'paragraph']);
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      runs: [{ text: 'What changed this week.', bold: false }],
    });
  });

  it('leaves markup and an unpaired mark as the characters they are', () => {
    expect(parseRuns('<img src=x onerror=alert(1)> and **half')).toEqual([
      { text: '<img src=x onerror=alert(1)> and **half', bold: false },
    ]);
    expect(parseRuns('[a link](https://example.com)')).toEqual([
      { text: '[a link](https://example.com)', bold: false },
    ]);
  });

  it('drops empty bold and empty notes', () => {
    expect(parseRuns('a****b')).toEqual([
      { text: 'a', bold: false },
      { text: 'b', bold: false },
    ]);
    expect(parseReleaseNotes('  \n\n')).toEqual([]);
  });
});
