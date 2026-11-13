// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V9, timeline part, on generated talking-head fixtures: the cleanup removes fillers, shortens long pauses
 * (to the kept breath, by the threshold setting) and cuts the earlier take of a retake, with no kept word
 * clipped — checked on the applied timeline's own clips at 24, 30 and 29.97 fps media on 30 and 29.97 fps
 * canvases. The ≥ 90% score on 10 labelled clips is the P3-Q2 eval (H3 labels).
 */
import {
  CLEANUP_SETTING,
  FrameRate,
  FrameRates,
  newId,
  RationalTime,
  TimeRange,
  type CleanupPlan,
  type CleanupSettings,
  type Clip,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { planCleanup } from '../../src/cleanup/plan-cleanup';
import { videoItems } from '../../src/model/sequence';
import { commandWorld, ui } from '../fixtures/command-world';
import { talkingHead, talkingTimeline, type TalkingHead } from '../fixtures/speech';

const defaults: CleanupSettings = CLEANUP_SETTING.defaultValue;
const ms = (time: RationalTime) => RationalTime.toSeconds(time) * 1000;

/** The source spans (ms) the timeline's clips play; spans that meet within `join` ms play as one. */
function played(timeline: Timeline, join = 0): [number, number][] {
  const spans = videoItems(timeline).flatMap((item) => {
    if (item.type !== 'clip') return [];
    const start = ms(item.sourceStart);
    return [[start, start + ms(item.duration)] as [number, number]];
  });
  const out: [number, number][] = [];
  for (const span of spans) {
    const last = out.at(-1);
    if (last && Math.abs(span[0] - last[1]) <= join + 1e-6) last[1] = Math.max(last[1], span[1]);
    else out.push([...span]);
  }
  return out;
}

const share = (span: readonly [number, number], spans: readonly [number, number][]) =>
  spans.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, span[1]) - Math.max(a, span[0])), 0) / (span[1] - span[0]);

async function cleaned(head: TalkingHead, media: FrameRate, canvas: FrameRate, settings = defaults) {
  const timeline = talkingTimeline(head, media, canvas);
  const plan = planCleanup(timeline, new Map([[head.analysis.assetId, head.analysis]]), settings, () => newId<'TimelineItem'>());
  if (!plan.ok) throw new Error(plan.error.code);
  const world = commandWorld();
  await world.seed(timeline);
  const done = await world.dispatch('timeline.applyCleanup', { projectId: timeline.projectId, timelineId: timeline.id, plan: plan.value });
  if (!done.ok) throw new Error(done.error.detail ?? done.error.code);
  return { timeline, plan: plan.value, after: world.doc(timeline.id), world };
}

const RATES: [string, FrameRate, FrameRate][] = [
  ['24 on 30', FrameRates.fps24, FrameRates.fps30],
  ['30 on 30', FrameRates.fps30, FrameRates.fps30],
  ['29.97 on 29.97', FrameRates.fps29_97, FrameRates.fps29_97],
  ['25 on 29.97', FrameRates.fps25, FrameRates.fps29_97],
];

describe.each(RATES)('talking-head cleanup, %s fps', (_label, media, canvas) => {
  it.each([1, 2, 3, 4, 5])('fixture %i: fillers and long pauses go, the retake goes, no kept word is clipped', async (seed) => {
    const head = talkingHead(newId<'Asset'>(), { seed, words: 30, fillerEvery: 4, pauseEvery: 5, retake: seed % 2 === 1 });
    const { after, plan, timeline } = await cleaned(head, media, canvas);
    const mediaFrameMs = 1000 / FrameRate.toNumber(media);
    // Punch-in splits keep the source continuous to within half a media frame.
    const spans = played(after, mediaFrameMs / 2);
    const margin = Math.max(0, defaults.padMs - mediaFrameMs);
    const window = played(timeline)[0] as [number, number];
    head.analysis.words.forEach((word, index) => {
      if (head.fillerWords.has(index) || head.retakeWords.has(index)) return;
      if (ms(word.range.start) < window[0] || ms(TimeRange.end(word.range)) > window[1]) return;
      const span: [number, number] = [ms(word.range.start) - margin, ms(TimeRange.end(word.range)) + margin];
      const whole = spans.some(([a, b]) => a <= span[0] + 1e-6 && b >= span[1] - 1e-6);
      expect(whole, `word ${index} (${word.text}) ${span.join('–')} whole in one clip`).toBe(true);
    });
    const fillers = [...head.fillerWords].map((index) => head.analysis.words[index]?.range as TimeRange);
    const fillersGone = fillers.filter((range) => share([ms(range.start), ms(TimeRange.end(range))], spans) < 0.5).length;
    expect(fillersGone / fillers.length).toBeGreaterThanOrEqual(0.9);
    const frameMs = 1000 / FrameRate.toNumber(canvas);
    const pausesShortened = head.longPauses.filter(
      ([start, end]) => share([start, end], spans) * (end - start) <= defaults.keepPauseMs + 2 * frameMs + mediaFrameMs + 1e-6,
    ).length;
    expect(pausesShortened / head.longPauses.length).toBeGreaterThanOrEqual(0.9);
    for (const index of head.retakeWords) {
      const range = head.analysis.words[index]?.range as TimeRange;
      expect(share([ms(range.start), ms(TimeRange.end(range))], spans)).toBeLessThan(0.5);
    }
    expect(plan.stats.fillers).toBe(fillers.length);
    expect(plan.stats.pauses).toBe(head.longPauses.length);
    expect(plan.stats.secondsSaved).toBeGreaterThan(0);
    // Whole canvas frames: the pieces fill exactly the shorter video.
    const length = videoItems(after).reduce((sum, item) => sum + (item.type === 'clip' ? item.duration.value : 0), 0);
    const original = videoItems(timeline)[0] as Clip;
    expect(original.duration.value - length).toBe(Math.round(plan.stats.secondsSaved * FrameRate.toNumber(canvas)));
  });
});

describe('cleanup settings and the plan', () => {
  const head = talkingHead(newId<'Asset'>(), { seed: 9, words: 30, fillerEvery: 5, pauseEvery: 4 });
  const timeline = talkingTimeline(head, FrameRates.fps30, FrameRates.fps30);
  const analyses = new Map([[head.analysis.assetId, head.analysis]]);
  const plan = (settings: Partial<CleanupSettings>) => {
    const made = planCleanup(timeline, analyses, { ...defaults, ...settings }, () => newId<'TimelineItem'>());
    if (!made.ok) throw new Error(made.error.code);
    return made.value;
  };

  it('shortens only pauses longer than the threshold', () => {
    const longest = Math.max(...head.longPauses.map(([start, end]) => end - start));
    expect(plan({ pauseThresholdMs: 500 }).stats.pauses).toBe(head.longPauses.length);
    expect(plan({ pauseThresholdMs: 2000 }).stats.pauses).toBe(head.longPauses.filter(([s, e]) => e - s > 2000).length);
    expect(longest).toBeLessThan(2000);
  });

  it('switches each rule off', () => {
    const none = plan({ fillers: false, pauses: false, retakes: false, punchIns: false });
    expect(none.clips).toEqual([]);
    expect(none.stats).toEqual({ fillers: 0, pauses: 0, retakes: 0, punchIns: 0, secondsSaved: 0 });
    expect(plan({ pauses: false, punchIns: false }).stats.pauses).toBe(0);
  });

  it('punches in on emphasis at the punch scale, at least the minimum gap apart', () => {
    const made = plan({});
    expect(made.stats.punchIns).toBeGreaterThan(0);
    const punches = made.clips.flatMap((clip) => clip.punch);
    for (const punch of punches) expect(punch.reframe).toEqual({ mode: 'centre', nudge: { x: 0, y: -0.1 }, scale: 1.1 });
    const starts = punches.map((punch) => ms(punch.range.start));
    starts.slice(1).forEach((start, index) => expect(start - (starts[index] as number)).toBeGreaterThanOrEqual(defaults.punchMinGapSeconds * 1000 - 1));
  });

  it('answers timeline.cleanup_no_speech when no clip has an analysis', () => {
    const made = planCleanup(timeline, new Map(), defaults, () => newId<'TimelineItem'>());
    expect(!made.ok && made.error.code).toBe('timeline.cleanup_no_speech');
  });
});

describe('timeline.applyCleanup', () => {
  it('keeps the first id, uses the plan ids, ripples text and caption words, and undoes in one step', async () => {
    const head = talkingHead(newId<'Asset'>(), { seed: 4, words: 20, fillerEvery: 3, pauseEvery: 4 });
    const base = talkingTimeline(head, FrameRates.fps30, FrameRates.fps30);
    const rate = base.canvas.rate;
    const last = head.analysis.words.at(-1)?.range as TimeRange;
    const lastFrame = Math.round(((ms(last.start) - 400) / 1000) * 30);
    const withText: Timeline = {
      ...base,
      tracks: base.tracks.map((track) =>
        track.kind !== 'text'
          ? track
          : {
              ...track,
              items: [
                {
                  type: 'text',
                  id: newId<'TimelineItem'>(),
                  start: RationalTime.of(lastFrame, rate),
                  duration: RationalTime.of(6, rate),
                  text: 'End',
                  role: 'title',
                  slotId: null,
                  overlayId: null,
                  box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
                  appearance: { size: 0.05, align: 'center', case: 'mixed', background: 'none' },
                  styleKey: 'title',
                  reveal: 'none',
                  language: 'en',
                  origin: 'user',
                },
              ],
            },
      ),
    };
    const plan = planCleanup(withText, new Map([[head.analysis.assetId, head.analysis]]), defaults, () => newId<'TimelineItem'>());
    if (!plan.ok) throw new Error(plan.error.code);
    const world = commandWorld();
    await world.seed(withText);
    const target = { projectId: withText.projectId, timelineId: withText.id };
    const done = await world.dispatch('timeline.applyCleanup', { ...target, plan: plan.value });
    if (!done.ok) throw new Error(done.error.detail ?? done.error.code);
    const after = world.doc(withText.id);
    const clips = videoItems(after).filter((item) => item.type === 'clip');
    const planned = plan.value.clips[0] as CleanupPlan['clips'][number];
    expect(clips.map((clip) => clip.id)).toEqual([videoItems(withText)[0]?.id, ...planned.newIds]);
    expect(clips.every((clip) => clip.type === 'clip' && clip.beatAnchor === null)).toBe(true);
    const text = after.tracks.find((track) => track.kind === 'text')?.items[0];
    const saved = Math.round(plan.value.stats.secondsSaved * 30);
    expect(text?.start.value).toBeLessThan(lastFrame);
    expect(lastFrame - (text?.start.value ?? 0)).toBeLessThanOrEqual(saved);
    // A plan made for another revision is stale; one undo puts the clip back.
    const stale = await world.dispatch('timeline.applyCleanup', { ...target, plan: plan.value });
    expect(!stale.ok && stale.error.code).toBe('timeline.cleanup_stale');
    await world.bus.undo(withText.projectId, ui);
    expect({ ...world.doc(withText.id), revision: 1, updatedAt: 0 }).toEqual({ ...withText, revision: 1, updatedAt: 0 });
    await world.bus.redo(withText.projectId, ui);
    expect(videoItems(world.doc(withText.id)).map((item) => item.id)).toEqual(clips.map((clip) => clip.id));
  });
});
