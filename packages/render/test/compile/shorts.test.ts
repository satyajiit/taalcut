// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { lintHyperframeHtml } from '@hyperframes/core/lint';
import { FrameRate, newId, RationalTime, type ClipVisualLayout, type Transcript } from '@taalcut/core';
import { assembleShort } from '@taalcut/timeline';
import { describe, expect, it } from 'vitest';
import { planAudioMix } from '../../src/audio/mix-plan';
import { captionWordsFromPlan } from '../../src/captions/cues';
import { compileComposition } from '../../src/compile/composition';
import { planTimeline } from '../../src/plan/render-plan';
import { presetFor } from '../../src/presets/presets.v1';
import { layoutSubjectCheck } from '../../src/qa/checks/visual-layout';
import { layoutSourceTime, layoutTransform, layoutCropAt } from '../../src/reframe/visual-layout';
import { sampleAt, trackOf } from '../reframe/support';

const rate = FrameRate.of(30);
const t = (frames: number) => RationalTime.of(frames, rate);
const range = (start: number, duration: number) => ({ start: t(start), duration: t(duration) });
const source = { width: 1920, height: 1080 };
const layout: ClipVisualLayout = {
  regions: [0, 1].map((index) => ({
    id: `panel-${index}`,
    viewport: { x: 0, y: index / 2, width: 1, height: 0.5 },
    fit: 'contain',
    keyframes: [{ at: t(0), crop: { x: index / 2, y: 0, width: 0.5, height: 1 } }],
  })),
};

function fixture() {
  const speechId = newId<'Asset'>();
  const pictureId = newId<'Asset'>();
  const made = assembleShort(
    {
      projectId: newId<'Project'>(),
      timelineId: newId<'Timeline'>(),
      name: 'Short',
      rate,
      plan: {
        candidateId: newId<'ShortCandidate'>(),
        title: 'Short',
        hook: 'The answer',
        speech: [{ source: { assetId: speechId, range: range(90, 60) }, start: t(0), duration: t(60) }],
        visuals: [{ source: { assetId: pictureId, range: range(30, 60) }, start: t(0), duration: t(60) }],
        duration: t(60),
        endingDuration: t(60),
      },
      assets: new Map([speechId, pictureId].map((id) => [id, { available: range(0, 600) }])),
      styleId: null,
      layouts: new Map([[0, layout]]),
      now: 0,
    },
    { item: () => newId<'TimelineItem'>() },
  );
  if (!made.ok) throw new Error(made.error.detail ?? made.error.code);
  const planned = planTimeline(made.value);
  if (!planned.ok) throw new Error(planned.error.detail ?? planned.error.code);
  return { timeline: made.value, plan: planned.value, speechId, pictureId };
}

describe('shorts render contracts', () => {
  it('captions and sample-exact audio follow speech even under unrelated pictures', () => {
    const { plan, speechId, pictureId } = fixture();
    const transcript = (text: string, start: number): Transcript => ({
      version: 1,
      language: 'en',
      engine: 'whisper',
      model: 'recorded',
      local: true,
      wordTiming: 'native',
      segments: [
        { text, range: range(start, 30), language: 'en', words: [{ text, range: range(start, 30) }] },
      ],
    });
    const words = captionWordsFromPlan(
      plan,
      new Map([
        [speechId, transcript('Actual speech', 90)],
        [pictureId, transcript('Wrong cutaway words', 30)],
      ]),
    );
    expect(words.map((word) => [word.text, word.range.start.value])).toEqual([['Actual speech', 0]]);
    expect(plan.audio).toHaveLength(1);
    expect(plan.audio[0]!.assetId).toBe(speechId);
    const mixed = planAudioMix(plan, { clip: () => ({ path: '/speech.wav', offset: t(90) }) });
    if (!mixed.ok) throw new Error(mixed.error.code);
    expect(mixed.value.segments).toHaveLength(1);
    expect(mixed.value.segments[0]).toMatchObject({ inSample: 144000, samples: 96000, startSample: 0 });
    expect(mixed.value).toMatchObject({ music: 'none', silent: false, referenceAudio: false });
  });

  it('preview and export share two native viewports, one media link, and exact timed seeks', async () => {
    const { timeline, plan } = fixture();
    const compile = (variant: 'preview' | 'export') => {
      const out = compileComposition(timeline, {
        variant,
        preset: presetFor('device'),
        burnCaptions: false,
        media: () => ({ file: '/source.mp4', key: 'source', ext: 'mp4', mediaStart: t(30) }),
        framing: { visuals: new Map(), warnings: [], sourceSizes: new Map([[plan.visuals[0]!.id, source]]) },
      });
      if (!out.ok) throw new Error(out.error.code);
      return out.value;
    };
    const output = compile('export');
    const html = output.files['index.html']!;
    expect(html.match(/<video /g)).toHaveLength(2);
    expect(html.match(/data-media-start="1.016666666"/g)).toHaveLength(2);
    expect(Object.keys(output.links).filter((key) => key.startsWith('media/'))).toHaveLength(1);
    const motion = (text: string) =>
      JSON.parse(text.match(/<script type="application\/json" id="tc-data">([^<]+)<\/script>/)![1]!).motion;
    expect(motion(html)).toEqual(motion(compile('preview').files['index.html']!));
    const lint = await lintHyperframeHtml(
      html.replace('<script src="tc.js"></script>', () => `<script>${output.files['tc.js']!}</script>`),
      {
        filePath: 'index.html',
        externalStyles: [{ href: 'tc.css', content: output.files['tc.css']! }],
      },
    );
    expect(lint.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
  });

  it('checks the actual native media and clipping viewport rectangles', () => {
    const { plan } = fixture();
    const visual = plan.visuals[0]!;
    const canvas = { width: plan.width, height: plan.height };
    const region = layout.regions[0]!;
    const placed = layoutTransform(region, layoutCropAt(region, 1), source, canvas);
    const probe = {
      id: `${visual.id}:region:0`,
      frame: 0,
      objectPosition: '50% 50%',
      scale: String(placed.scale),
      transformOrigin: '0px 0px',
      opacity: 1,
      box: {
        x: placed.viewport.x + placed.x,
        y: placed.viewport.y + placed.y,
        width: source.width * placed.scale,
        height: source.height * placed.scale,
      },
      viewport: placed.viewport,
    };
    const second = layoutTransform(layout.regions[1]!, layoutCropAt(layout.regions[1]!, 1), source, canvas);
    const otherProbe = {
      ...probe,
      id: `${visual.id}:region:1`,
      box: {
        x: second.viewport.x + second.x,
        y: second.viewport.y + second.y,
        width: source.width * second.scale,
        height: source.height * second.scale,
      },
      viewport: second.viewport,
    };
    const input = { clips: [{ visual, source, track: null }], canvas, rate, probed: [probe, otherProbe] };
    expect(layoutSubjectCheck(input).status).toBe('pass');
    expect(layoutSubjectCheck({ clips: input.clips, canvas, rate }).status).toBe('fail');
    expect(
      layoutSubjectCheck({ ...input, probed: [{ ...probe, box: { ...probe.box, x: probe.box.x + 5 } }] })
        .status,
    ).toBe('fail');
    expect(layoutSourceTime(visual, 30, rate)).toBe(2);
    expect(layoutSourceTime({ ...visual, holdFrame: t(75) }, 30, rate)).toBe(2.5);
    const sample = {
      ...sampleAt(1),
      heads: [{ box: { x: 0.8, y: 0.2, width: 0.1, height: 0.1 }, confidence: 0.9 }],
    };
    const track = trackOf([sample], 3, visual.assetId);
    expect(layoutSubjectCheck({ ...input, clips: [{ visual, source, track }] }).status).toBe('pass');
    const missingPerson = { ...visual, visualLayout: { regions: [layout.regions[0]!] } };
    expect(layoutSubjectCheck({ ...input, clips: [{ visual: missingPerson, source, track }] }).status).toBe(
      'fail',
    );
  });
});
