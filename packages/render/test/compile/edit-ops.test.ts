// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: what the editor's edits ask of the render. A clip's colour (over the whole video's) is planned and drawn
 * through one SVG filter per grade, the same in the preview and the export; an ungraded composition is unchanged.
 * A clip's sound fades are at least a transition's overlap; the music's bed is planned.
 */
import { lintHyperframeHtml } from '@hyperframes/core/lint';
import { FrameRate, NEUTRAL_GRADE, RationalTime, type Grade, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { compileComposition, type CompileOptions } from '../../src/compile/composition';
import { feColorMatrixValues, visualGradeMatrix } from '../../src/grade/clip-grade';
import { planTimeline } from '../../src/plan/render-plan';
import { presetFor } from '../../src/presets/presets.v1';
import { makeTimeline } from '../support/timeline';

const rate = FrameRate.of(30);
const t = (frames: number) => RationalTime.of(frames, rate);
const grade = (patch: Partial<Grade>): Grade => ({ ...NEUTRAL_GRADE, ...patch });

const media: CompileOptions['media'] = (visual) => ({
  file: `/media/${visual.assetId}.mp4`,
  key: `key-${visual.assetId}`,
  mediaStart: RationalTime.zero(rate),
  ext: 'mp4',
});

function compile(timeline: Timeline, variant: 'export' | 'preview' = 'export') {
  const result = compileComposition(timeline, { variant, preset: presetFor('device'), burnCaptions: false, media });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

/** Three clips: the first warmed, a crossfade into the second, the whole video in black and white. */
function graded(): Timeline {
  const base = makeTimeline({
    rate,
    items: [{ frames: 30 }, { frames: 30, transition: { kind: 'dissolve', inFrames: 5, outFrames: 5 } }, { frames: 30 }],
  });
  const video = base.tracks[0]!;
  if (video.kind !== 'video') throw new Error('no V1');
  const items = video.items.map((item, index) => (index === 0 && item.type === 'clip' ? { ...item, grade: grade({ temperature: 0.5 }) } : item));
  return { ...base, grade: grade({ look: 'mono' }), tracks: [{ ...video, items }, ...base.tracks.slice(1)] };
}

describe('the editor’s colour in the render', () => {
  it('plans a clip’s grade before the whole video’s, and none for a clip with neither', () => {
    const plan = planTimeline(graded());
    if (!plan.ok) throw new Error(plan.error.code);
    expect(plan.value.visuals.map((visual) => visual.grades?.map((g) => g.look ?? g.temperature))).toEqual([
      [0.5, 'mono'],
      ['mono'],
      ['mono'],
    ]);
    const plain = planTimeline(makeTimeline({ rate, items: [{ frames: 30 }] }));
    expect(plain.ok && plain.value.visuals[0]!.grades).toBeUndefined();
  });

  it('draws each distinct grade once, as a feColorMatrix the graded visuals are wrapped in', () => {
    const timeline = graded();
    const html = compile(timeline).files['index.html']!;
    const [first, second] = timeline.tracks[0]!.items.filter((item) => item.type === 'clip');
    const values = feColorMatrixValues(visualGradeMatrix([grade({ temperature: 0.5 }), grade({ look: 'mono' })])!);
    expect(html.match(/<filter /g)).toHaveLength(2);
    expect(html).toContain(`values="${values}"`);
    expect(html).toMatch(new RegExp(`<div id="gw-${first!.id}" class="tc-graded">\\s*<video id="v-${first!.id}"`));
    expect(html).toContain(`<div id="gw-${second!.id}" class="tc-graded">`);
    const css = compile(timeline).files['tc.css'] ?? html;
    expect(css).toMatch(new RegExp(`#gw-${first!.id} \\{[^}]*filter: url\\(#tcgrade[a-z]+\\)`));
  });

  it('is the same filter in the preview and the export', () => {
    const filters = (html: string) => html.match(/<svg class="tc-grades"[\s\S]*?<\/svg>/)?.[0];
    const exportHtml = compile(graded(), 'export').files['index.html']!;
    expect(filters(exportHtml)).toBeDefined();
    expect(filters(compile(graded(), 'preview').files['index.html']!)).toBe(filters(exportHtml));
  });

  it('leaves an ungraded composition as it was, and a neutral grade draws nothing', () => {
    const plainTimeline = makeTimeline({ rate, items: [{ frames: 30 }, { frames: 30 }] });
    const plain = compile(plainTimeline);
    expect(plain.files['index.html']).not.toContain('tc-grades');
    const neutral = compile({ ...plainTimeline, grade: NEUTRAL_GRADE });
    expect(neutral.files['index.html']).toBe(plain.files['index.html']);
  });

  it('draws highlight-only corrections in preview and export, after each grade matrix', () => {
    const timeline = { ...graded(), grade: grade({ highlights: -0.6, whites: -0.4 }) };
    const filters = (variant: 'preview' | 'export') =>
      compile(timeline, variant).files['index.html']!.match(/<svg class="tc-grades"[\s\S]*?<\/svg>/)?.[0];
    const exported = filters('export');
    expect(exported).toContain('<feComponentTransfer>');
    expect(exported).toContain('<feFuncR type="table" tablevalues="');
    expect(exported).toContain('<feFuncG type="table" tablevalues="');
    expect(exported).toContain('<feFuncB type="table" tablevalues="');
    expect(filters('preview')).toBe(exported);
    expect(exported).toMatch(/<\/feColorMatrix><feComponentTransfer>/);
  });

  it('does not change old colour filter markup when the new controls are zero', () => {
    const timeline = graded();
    const zero = { ...timeline, grade: { ...timeline.grade!, highlights: 0, whites: 0 } };
    expect(compile(zero).files['index.html']).toBe(compile(timeline).files['index.html']);
  });

  it('passes HyperFrames’ linter with grades', async () => {
    const bundle = compile({ ...graded(), grade: grade({ highlights: -0.6, whites: -0.4 }) });
    const html = bundle.files['index.html']!.replace(
      '<script src="tc.js"></script>',
      () => `<script>${bundle.files['tc.js']!}</script>`,
    );
    const lint = await lintHyperframeHtml(html, {
      filePath: 'index.html',
      externalStyles: [{ href: 'tc.css', content: bundle.files['tc.css']! }],
    });
    expect(lint.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
  });
});

describe('the editor’s sound in the plan', () => {
  it('fades a clip’s sound for its own fade or a transition’s overlap, whichever is longer', () => {
    const base = makeTimeline({
      rate,
      items: [{ frames: 30 }, { frames: 30, transition: { kind: 'dissolve', inFrames: 3, outFrames: 3 } }],
    });
    const video = base.tracks[0]!;
    if (video.kind !== 'video') throw new Error('no V1');
    const items = video.items.map((item) =>
      item.type === 'clip' ? { ...item, audio: { gainDb: 0, muted: false, fadeIn: t(10), fadeOut: t(2) } } : item,
    );
    const plan = planTimeline({ ...base, tracks: [{ ...video, items }] });
    if (!plan.ok) throw new Error(plan.error.code);
    expect(plan.value.audio.map((clip) => [clip.fadeInFrames, clip.fadeOutFrames])).toEqual([
      [10, 6],
      [10, 2],
    ]);
  });

  it('carries the music’s bed', () => {
    const bed = { start: t(15), end: null, shift: t(15), fadeIn: t(0), fadeOut: t(30), muted: false };
    const base = makeTimeline({ rate, items: [{ frames: 90 }] });
    const plan = planTimeline({ ...base, mix: { ...base.mix, music: bed } });
    expect(plan.ok && plan.value.musicBed).toEqual(bed);
  });
});
