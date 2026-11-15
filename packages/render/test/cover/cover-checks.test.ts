// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CVR2: what the gate lets a cover composition write (a picture by reference, a mask), and what the drawn cover's
 * checks say, in words, of a cover that is broken, weak, or not what its medium says.
 */
import { createHash } from 'node:crypto';
import { VIDEO_SIZES, type ThumbnailAspect } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { coverChecks, coverSafeRect, type CoverFacts } from '../../src/cover/cover-checks';
import { pictureNamesOf } from '../../src/cover/cover-composition';
import type { ProbedContent } from '../../src/workspace/frames/content-probe';
import { gateComposition } from '../../src/workspace/gate/workspace-gate';
import { compositionText } from './composed-fixture';

const gate = async (html: string) => {
  const result = await gateComposition({
    entry: 'cover/index.html',
    files: [
      {
        path: 'cover/index.html',
        sha256: createHash('sha256').update(html).digest('hex'),
        bytes: Buffer.byteLength(html),
        text: html,
      },
    ],
  });
  return { result, errors: result.findings.filter((finding) => finding.severity === 'error') };
};

describe('a cover composition at the gate (CVR2)', () => {
  it.each(['poster-9x16.html', 'split-16x9.html', 'duo-4x5.html', 'window-1x1.html'])(
    'passes %s: a picture by reference, on the cover’s own canvas',
    async (file) => {
      const { result, errors } = await gate(await compositionText(file));
      expect(errors).toEqual([]);
      expect(result.gate.passed).toBe(true);
      expect(pictureNamesOf(result.prepared!.doc.root).length).toBeGreaterThan(0);
    },
  );

  it('reads the pictures a composition names, each once', async () => {
    const { result } = await gate(await compositionText('duo-4x5.html'));
    expect(pictureNamesOf(result.prepared!.doc.root)).toEqual(['dusk', 'dawn']);
    const window = await gate(await compositionText('window-1x1.html'));
    expect(pictureNamesOf(window.result.prepared!.doc.root)).toEqual(['hero']);
  });

  it('lets a mask fade a picture, and refuses a picture or a mask that loads anything', async () => {
    const html = await compositionText('poster-9x16.html');
    const masked = html.replace(
      'object-fit: cover;',
      'object-fit: cover;\n          mask-image: linear-gradient(to top, transparent 0%, #000000 40%);',
    );
    expect((await gate(masked)).errors).toEqual([]);
    const remote = html.replace(
      'object-fit: cover;',
      'object-fit: cover;\n          mask-image: url(https://example.com/m.png);',
    );
    expect((await gate(remote)).result.gate.passed).toBe(false);
    for (const picture of [
      '<img id="shot" data-picture="Hero shot" alt="" />',
      '<img id="shot" data-picture="hero" src="https://example.com/a.jpg" alt="" />',
      '<img id="shot" data-picture="hero" src="frames/a.jpg" alt="" />',
    ])
      expect(
        (await gate(html.replace('<img id="shot" data-picture="hero" alt="" />', picture))).result.gate
          .passed,
        picture,
      ).toBe(false);
  });
});

const run = (text: string, sizePx: number, left: number, top: number, width = 400) => ({
  text,
  top,
  left,
  right: left + width,
  bottom: top + sizePx,
  sizePx,
  colour: '#ffffff',
  family: 'Anton',
  backdrop: null,
});
const content = (...texts: ProbedContent['texts'][number][]): ProbedContent => ({
  id: 'COVER',
  box: { x: 0, y: 0, width: 1080, height: 1920 },
  texts,
});
const FULL: CoverFacts = {
  pictures: [{ name: 'hero', loaded: true, shown: true, share: 1 }],
  shapes: 1,
  cut: [],
};
const checks = (
  facts: CoverFacts,
  drawn: ProbedContent | null,
  aspect: ThumbnailAspect = '9:16',
  medium: 'footage' | 'drawn' | 'generated' = 'footage',
) =>
  Object.fromEntries(
    coverChecks({ aspect, ...VIDEO_SIZES[aspect], medium, content: drawn, facts, fonts: ['anton'] }).map(
      (check) => [check.id, check],
    ),
  );

describe('what a drawn cover says of itself (CVR2)', () => {
  it('passes a headline in the safe area over a full-bleed frame', () => {
    const said = checks(FULL, content(run('North of nowhere', 206, 90, 1000), run('Day 4', 54, 90, 900)));
    expect(Object.values(said).map((check) => check.status)).toEqual([
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
    ]);
  });

  it('says which word is cut, by how much and at which edge', () => {
    const said = checks({ ...FULL, cut: [{ text: 'Nowhere', edge: 'right', by: 64 }] }, content());
    expect(said.words).toEqual({
      id: 'words',
      status: 'fail',
      detail:
        '"Nowhere" runs 64 px past the right edge, so it is cut. Keep every word whole on the 1080×1920 canvas: a smaller font-size, a max-width with wrapping, or fewer words.',
    });
  });

  it('says the smallest word and the size that would read', () => {
    const said = checks(FULL, content(run('North', 206, 90, 1000), run('a tiny credit', 24, 90, 900)));
    expect(said.typeFloor?.status).toBe('fail');
    expect(said.typeFloor?.detail).toMatch(
      /^"a tiny credit" has a cap height of \d+\.\d px, under 36: it will not read at feed size\. Set it at font-size \d+ px or more, or leave it out\.$/,
    );
  });

  it('holds the headline, not the small marks, to the aspect’s crop-safe area', () => {
    // 9:16: the caption zone starts at y 1440.
    const low = checks(FULL, content(run('North', 206, 90, 1500), run('Day 4', 54, 90, 60)));
    expect(low.safeArea?.status).toBe('fail');
    expect(low.safeArea?.detail).toContain('the headline "North" sits 266 px below it');
    expect(low.safeArea?.detail).toContain('x 76 px–886 px, y 480 px–1440 px');
    // The same small mark alone outside the area is its own headline: it is the largest words there are.
    expect(
      checks(FULL, content(run('North', 206, 90, 1000), run('Day 4', 54, 90, 60))).safeArea?.status,
    ).toBe('pass');
    for (const aspect of ['9:16', '16:9', '4:5', '1:1'] as const) {
      const safe = coverSafeRect(aspect);
      expect(safe.left).toBe(0.07);
      expect(safe.top + safe.bottom).toBeLessThan(0.6);
    }
  });

  it('holds a footage cover to its footage, and leaves other art to the person who asked for it', () => {
    const stamp = { ...FULL, pictures: [{ name: 'hero', loaded: true, shown: true, share: 0.08 }] };
    expect(checks(stamp, content()).pictures?.detail).toBe(
      "the video's pictures cover 8% of the cover, under 30%: on a footage cover the frame is the picture, not a stamp. Give it the room (full bleed, or a large panel).",
    );
    expect(checks({ ...FULL, pictures: [] }, content()).pictures?.detail).toContain(
      'states medium "footage" and draws no picture',
    );
    const hidden = { ...FULL, pictures: [{ name: 'hero', loaded: true, shown: false, share: 1 }] };
    expect(checks(hidden, content()).pictures?.status).toBe('fail');
    expect(checks({ ...FULL, shapes: 14 }, content()).marks?.detail).toBe(
      "the cover draws 14 shapes. Over footage, shapes are marks (a rule, an arrow, a ring), at most 8: the scene, the people and the objects are the picture's, never drawn.",
    );
    const drawn = checks({ ...FULL, pictures: [], shapes: 40 }, content(), '9:16', 'drawn');
    expect([drawn.pictures?.status, drawn.marks?.status]).toEqual(['pass', 'pass']);
    // In any medium, a picture that did not load is a broken cover.
    const broken = { ...FULL, pictures: [{ name: 'art', loaded: false, shown: true, share: 1 }] };
    expect(checks(broken, content(), '9:16', 'generated').pictures?.detail).toBe(
      'the picture "art" did not load, so its image draws nothing',
    );
  });
});
