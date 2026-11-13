// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { claimViolations, HEDGES } from '#content/claims';
import { filesUnder, proseLiterals, read } from './source-files';

/** WEB2's hedge sweep: nothing a visitor reads says the thing they see isn't real. */
function hedges(text: string) {
  return HEDGES.filter(({ pattern }) => pattern.test(text)).map(({ why }) => ({ text, why }));
}

describe('the hedge sweep', () => {
  it('catches the hedges, and lets the true sentence through', () => {
    for (const bad of [
      'Each one works below, on sample footage.',
      'Sample template, timings estimated',
      'A sample camera roll',
      'The agent checks its draft against the reel.',
      'This notice is a draft under legal review.',
      'Beats made up for this demo',
      'This reel’s own shots stand in for your camera roll.',
      'A stand-in until the real one lands',
      'Placeholder reel',
    ]) {
      expect(claimViolations(bad), bad).not.toEqual([]);
    }
    for (const good of [
      'Each one works below, on a real reel and its footage.',
      'The agent checks the cut against the reel before you see it.',
      'This reel’s own shots make up the camera roll here.',
      'Last updated 1 November 2026.',
    ]) {
      expect(claimViolations(good), good).toEqual([]);
    }
  });

  it('holds for every prose string in the site’s source: pages, components and content', () => {
    const files = [...filesUnder('src/app', ['.tsx', '.ts']), ...filesUnder('src/components', ['.tsx', '.ts']), ...filesUnder('src/content', ['.ts'])].filter(
      (f) => !f.endsWith('media.gen.ts') && !f.endsWith('claims.ts'),
    );
    const found = files.flatMap((file) => proseLiterals(read(file)).flatMap(hedges).map((v) => ({ file, ...v })));
    expect(found).toEqual([]);
  });

  it('reads prose literals and skips class names, keys and comments', () => {
    const texts = proseLiterals(
      `// A sample comment\nconst a = 'placeholder:text-ink-3 hover:border-ink-3';\nconst b = 'Sample reel';\nconst c = { timing: 'estimated' };\nconst d = "That’s yours";\nconst e = \`\${label}: all filled. Sample footage.\`;`,
    );
    expect(texts).toEqual(['Sample reel', 'That’s yours', '${label}: all filled. Sample footage.']);
  });
});
