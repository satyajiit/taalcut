// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The set and its plans: what ix-v1 covers, and that a plan is the same every time and adds up. */
import { describe, expect, it } from 'vitest';
import { audioGraph, sayRun } from '../src/audio';
import { encodeArgs, finishArgs, videoCodecArgs } from '../src/encode';
import { planClip, plannedSeconds } from '../src/plan';
import { clipSeed, seeded } from '../src/random';
import { footageSet } from '../src/sets/index';
import { IX_V1 } from '../src/sets/ix-v1';
import { parseVoices } from '../src/tools';
import { videoGraph } from '../src/video/graph';
import { textImage } from '../src/video/pixel-font';

const clip = (file: string) => {
  const found = IX_V1.clips.find((item) => item.file === file);
  if (found === undefined) throw new Error(file);
  return found;
};

describe('ix-v1', () => {
  it('is ten minutes in eighteen files, more than half of it 4K', () => {
    const seconds = IX_V1.clips.reduce((sum, item) => sum + item.seconds, 0);
    expect(seconds).toBe(600);
    expect(IX_V1.clips).toHaveLength(18);
    const fourK = IX_V1.clips.filter((item) => Math.max(item.width, item.height) >= 3840);
    expect(fourK.reduce((sum, item) => sum + item.seconds, 0)).toBe(320);
    expect(new Set(IX_V1.clips.map((item) => item.file)).size).toBe(18);
  });

  it('covers what design G asks for', () => {
    const has = (test: (item: (typeof IX_V1.clips)[number]) => boolean) => IX_V1.clips.some(test);
    expect(has((c) => c.width === 3840 && c.codec === 'hevc' && c.fps === 30)).toBe(true);
    expect(has((c) => c.width === 3840 && c.codec === 'hevc' && c.fps === 60)).toBe(true);
    expect(has((c) => c.width === 1920 && c.codec === 'h264')).toBe(true);
    expect(IX_V1.clips.filter((c) => c.height > c.width).map((c) => [c.width, c.height])).toEqual([
      [1080, 1920],
      [1080, 1920],
    ]);
    expect(new Set(IX_V1.clips.flatMap((c) => (c.speech ? [c.speech.language] : [])))).toEqual(
      new Set(['en', 'es', 'pt-BR', 'hi']),
    );
    expect(IX_V1.clips.filter((c) => c.speech === null).map((c) => c.bed)).toEqual([
      'music',
      'room',
      'music',
    ]);
    expect(IX_V1.clips.some((c) => c.onScreen.length > 0)).toBe(true);
    expect(IX_V1.clips.some((c) => c.bars)).toBe(true);
  });

  it('has one search probe per language, each without music, each word said once', () => {
    const probes = IX_V1.clips.flatMap((c) => (c.speech?.probe ? [c] : []));
    expect(probes.map((c) => c.speech?.language).sort()).toEqual(['en', 'es', 'hi', 'pt-BR']);
    for (const probe of probes) {
      expect(probe.bed).not.toBe('music');
      const word = probe.speech?.probe ?? '';
      expect(IX_V1.clips.filter((c) => c.speech?.text.includes(word))).toHaveLength(1);
    }
    expect(footageSet('ix-v1')).toBe(IX_V1);
    expect(() => footageSet('ix-v9')).toThrow('ix-v1');
  });
});

describe('planClip', () => {
  it('is the same plan for the same seed, and another for another seed', () => {
    const city = clip('city-4k-hevc30-en.mov');
    expect(planClip(IX_V1, city)).toEqual(planClip(IX_V1, city));
    expect(planClip({ ...IX_V1, seed: 1 }, city).shots).not.toEqual(planClip(IX_V1, city).shots);
    expect(seeded(5).next()).toBe(seeded(5).next());
    expect(clipSeed(1, 'a')).not.toBe(clipSeed(1, 'b'));
  });

  it('adds every clip up to its length with 3–9 s shots, cuts at the shot starts', () => {
    for (const item of IX_V1.clips) {
      const plan = planClip(IX_V1, item);
      expect(plannedSeconds(plan), item.file).toBeCloseTo(item.seconds, 3);
      for (const shot of plan.shots) {
        expect(shot.seconds, item.file).toBeGreaterThanOrEqual(3);
        expect(shot.seconds, item.file).toBeLessThanOrEqual(9.001);
      }
      expect(plan.cuts.map((cut) => cut.at)).toEqual(plan.shots.slice(1).map((shot) => shot.startsAt));
      expect(plan.shots[0]?.dissolve).toBe(0);
      plan.shots.forEach((shot, index) => {
        if (index > 0) expect(shot.look, item.file).not.toBe(plan.shots[index - 1]?.look);
      });
    }
  });

  it('dissolves about one change in four, and places bars, text and music', () => {
    const plans = IX_V1.clips.map((item) => planClip(IX_V1, item));
    const cuts = plans.flatMap((plan) => plan.cuts);
    const dissolves = cuts.filter((cut) => cut.kind === 'dissolve');
    expect(dissolves.length / cuts.length).toBeGreaterThan(0.1);
    expect(dissolves.length / cuts.length).toBeLessThan(0.45);
    for (const plan of plans) {
      expect(plan.shots.filter((shot) => shot.look === 'bars')).toHaveLength(plan.clip.bars ? 1 : 0);
      expect(plan.shots[0]?.look).not.toBe('bars');
      expect(plan.texts.map((text) => text.line)).toEqual(plan.clip.onScreen);
      for (const text of plan.texts) expect(text.to).toBeLessThanOrEqual(plan.clip.seconds);
      expect(plan.music === null).toBe(plan.clip.bed !== 'music');
    }
  });
});

describe('graphs and arguments', () => {
  it('joins shots by concat and xfade at the planned offsets, and turns portrait clips', () => {
    const portrait = clip('street-portrait-h264-en.mp4');
    const plan = planClip(IX_V1, portrait);
    const graph = videoGraph(plan, '/work');
    expect(graph.filter).toContain('transpose=2,format=yuv420p[v]');
    expect(graph.filter.split(';').filter((chain) => /concat|xfade/.test(chain))).toHaveLength(
      plan.shots.length - 1,
    );
    for (const cut of plan.cuts.filter((item) => item.kind === 'dissolve'))
      expect(graph.filter).toContain(`duration=${cut.seconds}:offset=${cut.at}`);
    expect(graph.texts).toHaveLength(portrait.onScreen.length);
    expect(graph.inputs).toBe(graph.stills.length + graph.texts.length);
    expect(videoGraph(planClip(IX_V1, clip('city-4k-hevc30-en.mov')), '/w').filter).not.toContain(
      'transpose',
    );
  });

  it('encodes at the clip bitrate and finishes with the phone metadata, one creation time in an .mp4', () => {
    const city = planClip(IX_V1, clip('city-4k-hevc30-en.mov'));
    expect(videoCodecArgs(city)).toEqual(
      expect.arrayContaining(['hevc_videotoolbox', 'hvc1', '40M', '60M', '80M', '-g', '30']),
    );
    const kitchen = planClip(IX_V1, clip('kitchen-1080-h264-en.mp4'));
    expect(videoCodecArgs(kitchen).slice(0, 4)).toEqual(['-c:v', 'h264_videotoolbox', '-require_sw', '1']);
    const args = encodeArgs({
      plan: kitchen,
      videoInputs: [],
      speech: '/w/s.aiff',
      speechInput: 0,
      filter: 'x',
      hasAudio: true,
      out: '/w/e.mp4',
    });
    expect(args).toEqual(
      expect.arrayContaining(['-i', '/w/s.aiff', '-map', '[a]', '-c:a', 'aac', '-t', '40']),
    );
    expect(finishArgs(city, 'in.mov', 'out.mov')).toEqual(
      expect.arrayContaining(['creation_time=2026-09-12T07:41:10Z', 'com.apple.quicktime.make=Apple']),
    );
    const portrait = planClip(IX_V1, clip('rooftop-portrait-hevc30-hi.mov'));
    expect(finishArgs(portrait, 'in.mov', 'out.mov').slice(4, 6)).toEqual(['-display_rotation:v:0', '-90']);
    const mp4 = finishArgs(kitchen, 'in.mp4', 'out.mp4');
    expect(mp4).toEqual(
      expect.arrayContaining(['-map_metadata', '-1', 'creation_time=2026-09-13T19:10:27Z']),
    );
    expect(mp4.join(' ')).not.toContain('use_metadata_tags');
  });

  it('mixes speech over its bed, and beds alone when nobody speaks', () => {
    const run = planClip(IX_V1, clip('run-4k-hevc60-en.mov'));
    expect(audioGraph(run, 3)).toMatch(/\[3:a\].*\[speech\].*aevalsrc=.*volume=0\.35\[bed\].*amix=inputs=2/);
    expect(audioGraph(planClip(IX_V1, clip('bike-4k-hevc60-music.mov')), null)).toMatch(
      /volume=1\[bed\];\[bed\]anull\[a\]$/,
    );
    expect(audioGraph(planClip(IX_V1, clip('lake-1080-h264-silent.mp4')), null)).toContain('c=brown');
    expect(audioGraph(planClip(IX_V1, clip('kitchen-1080-h264-en.mp4')), 0)).toMatch(/\[speech\]anull\[a\]$/);
    const none = planClip(IX_V1, { ...clip('kitchen-1080-h264-en.mp4'), speech: null });
    expect(audioGraph(none, null)).toBeNull();
    const say = sayRun('one two three four five', 'Samantha', 20, '/w/a.aiff');
    expect(say.text.split('[[slnc 1200]]').length).toBeGreaterThanOrEqual(6);
  });

  it('draws text in pixels and reads the voices say lists', () => {
    const image = textImage('Take 4!');
    expect([image.width, image.height]).toEqual([7 * 6 + 1, 9]);
    expect(new TextDecoder().decode(image.ppm.slice(0, 10))).toBe('P6\n43 9\n25');
    expect(() => textImage('naïve')).toThrow('Ï');
    expect(
      parseVoices(
        'Samantha            en_US    # Hello\nEddy (English (US)) en_US    # Hi\nMónica              es_ES    # Hola\n',
      ),
    ).toEqual(['Samantha', 'Eddy (English (US))', 'Eddy', 'Mónica']);
    // Newer macOS lists a classic voice only by its long name (twice, for two qualities); `say -v Daniel` still
    // takes the short one, so both are listed, once each.
    expect(
      parseVoices(
        'Daniel (English (UK)) en_GB    # Hello\nDaniel (English (UK)) en_GB    # Hello\nAlbert              en_US    # Hi\n',
      ),
    ).toEqual(['Daniel (English (UK))', 'Daniel', 'Albert']);
  });
});
