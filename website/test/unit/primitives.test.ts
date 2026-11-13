// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { Music } from 'lucide-react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppWindow, APP_AREAS, APP_WINDOW_WIDTH } from '#components/ui/app-window';
import { IconText } from '#components/ui/icon-text';
import { ReelFrame } from '#components/ui/reel-frame';
import { Arrive, Section } from '#components/ui/section';
import { SegmentBar } from '#components/ui/segment-bar';
import { Sticker } from '#components/ui/sticker';
import { arrivalAtMount, arrivalThreshold } from '#lib/arrival';
import { driftToward } from '#lib/pointer';
import { reelControlLabel, reelShouldPlay } from '#components/ui/reel-play';
import { beatPosition, beatPulsing, groupsOf, type Segment, segmentBarLabel, segmentFill } from '#components/ui/segments';

const SEGMENTS: Segment[] = [
  { start: 0, end: 2, group: 'hook' },
  { start: 2, end: 3, group: 'build' },
  { start: 3, end: 4, group: 'build', unsure: true },
  { start: 4, end: 5, group: 'peak' },
  { start: 5, end: 8, group: 'outro' },
];

describe('the segment bar’s arithmetic', () => {
  it('groups neighbouring slots into their parts', () => {
    expect(groupsOf(SEGMENTS)).toEqual([
      { group: 'hook', from: 1, to: 1 },
      { group: 'build', from: 2, to: 3 },
      { group: 'peak', from: 4, to: 4 },
      { group: 'outro', from: 5, to: 5 },
    ]);
  });

  it('fills a segment by the reel’s time', () => {
    expect(segmentFill(SEGMENTS[0]!, -1)).toBe(0);
    expect(segmentFill(SEGMENTS[0]!, 1)).toBe(0.5);
    expect(segmentFill(SEGMENTS[0]!, 9)).toBe(1);
  });

  it('places a beat on an equal bar by its slot, and on a time bar by the clock', () => {
    expect(beatPosition(SEGMENTS, 1, 'equal')).toBeCloseTo(0.1);
    expect(beatPosition(SEGMENTS, 2.5, 'equal')).toBeCloseTo(0.3);
    expect(beatPosition(SEGMENTS, 2, 'time')).toBeCloseTo(0.25);
    expect(beatPosition(SEGMENTS, 99, 'equal')).toBe(1);
  });

  it('swells a tick just after the playhead crosses it', () => {
    expect(beatPulsing(2, 2.05, 0.18)).toBe(true);
    expect(beatPulsing(2, 1.99, 0.18)).toBe(false);
    expect(beatPulsing(2, 2.3, 0.18)).toBe(false);
  });

  it('reads as its slots, parts, beats and doubts', () => {
    expect(segmentBarLabel(SEGMENTS, 9)).toBe('Template: 5 slots (Hook 1, Build 2 to 3, Peak 4, Outro 5), 9 music beats; the AI is unsure of one cut');
  });
});

describe('the reel frame’s playback', () => {
  const base = { intent: 'auto', autoPlay: true, reduce: false, onScreen: true, tabShown: true } as const;
  it('plays on its own only on screen, in a shown tab, without reduced motion', () => {
    expect(reelShouldPlay(base)).toBe(true);
    expect(reelShouldPlay({ ...base, onScreen: false })).toBe(false);
    expect(reelShouldPlay({ ...base, tabShown: false })).toBe(false);
    expect(reelShouldPlay({ ...base, reduce: true })).toBe(false);
  });

  it('keeps the visitor’s Pause wherever it scrolls, and their Play under reduced motion', () => {
    expect(reelShouldPlay({ ...base, intent: 'paused' })).toBe(false);
    expect(reelShouldPlay({ ...base, intent: 'playing', reduce: true })).toBe(true);
    expect(reelShouldPlay({ ...base, intent: 'playing', onScreen: false })).toBe(false);
    expect(reelControlLabel(true)).toBe('Pause the reel');
    expect(reelControlLabel(false)).toBe('Play the reel');
  });

  it('renders a muted, inline video with its poster, its label and a Play control, the bar and stickers in their slots', () => {
    const html = renderToStaticMarkup(
      h(ReelFrame, {
        sources: [{ src: '/r.mp4', type: 'video/mp4' }],
        poster: '/p.webp',
        label: 'A saved reel',
        bar: h('span', { 'data-test': 'bar' }),
        stickers: h('span', { 'data-test': 'stickers' }),
        bottom: h('span', null, 'Use template'),
      }),
    );
    expect(html).toMatch(/<video[^>]*aria-label="A saved reel"[^>]*poster="\/p.webp"[^>]*playsInline=""|<video[^>]*playsinline/i);
    expect(html).toContain('muted=""');
    expect(html).toContain('aria-label="Play the reel"');
    expect(html).toContain('data-test="bar"');
    expect(html).toContain('data-test="stickers"');
    expect(html).toContain('Use template');
    expect(html).toContain('rounded-reel');
  });
});

describe('arrivals and drift', () => {
  it('hides only what the visitor can’t see yet, and never under reduced motion', () => {
    expect(arrivalAtMount({ reduce: false, top: 1200, viewportHeight: 900, canObserve: true })).toBe('hidden');
    expect(arrivalAtMount({ reduce: false, top: 400, viewportHeight: 900, canObserve: true })).toBe('shown');
    expect(arrivalAtMount({ reduce: true, top: 1200, viewportHeight: 900, canObserve: true })).toBe('shown');
    expect(arrivalAtMount({ reduce: false, top: 1200, viewportHeight: 900, canObserve: false })).toBe('shown');
  });

  it('lets an element taller than the screen arrive once it fills the arrival share of the screen', () => {
    // An ordinary block: a third of it on screen.
    expect(arrivalThreshold({ amount: 0.3, height: 600, viewportHeight: 900 })).toBe(0.3);
    // Three screens tall: 0.3 of it could never be on screen at once; a tenth of it fills 0.3 of the screen.
    expect(arrivalThreshold({ amount: 0.3, height: 2700, viewportHeight: 900 })).toBeCloseTo(0.1);
    for (const height of [900, 1800, 4000, 12000]) {
      const share = arrivalThreshold({ amount: 0.3, height, viewportHeight: 900 });
      expect(share * height).toBeLessThanOrEqual(900 * 0.3 + 0.001);
    }
    // Not measured yet: the amount as asked.
    expect(arrivalThreshold({ amount: 0.3, height: 0, viewportHeight: 900 })).toBe(0.3);
  });

  it('leans toward the pointer, never further than its reach', () => {
    const [x, y] = driftToward(0, 0, 100, 0, 6);
    expect(x).toBeGreaterThan(0);
    expect(y).toBe(0);
    for (const [px, py] of [[5000, 0], [30, 40], [-200, -200]] as const) expect(Math.hypot(...driftToward(0, 0, px, py, 6))).toBeLessThanOrEqual(6);
    expect(driftToward(0, 0, 0, 0, 6)).toEqual([0, 0]);
  });
});

describe('the primitives’ server HTML', () => {
  it('starts every section and sticker visible: no opacity 0 before JavaScript', () => {
    const html = renderToStaticMarkup(
      h(Section, { heading: 'A heading', lead: 'A lead', children: h(Arrive, { children: h(Sticker, { icon: Music, children: '23 music beats' }) }) }),
    );
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
    expect(html).toMatch(/<section[^>]*aria-labelledby="([^"]+)"[^>]*>.*<h2 id="\1"/s);
    expect(html).toContain('23 music beats');
    expect(html).toContain('data-field="pink"');
    expect(html).toMatch(/rotate\(-3deg\)/);
  });

  it('labels the app window as a demonstration, with the sidebar’s five areas and one current', () => {
    const html = renderToStaticMarkup(h(AppWindow, { title: 'Remix a reel', area: 'templates', children: h('p', null, 'page') }));
    expect(html).toContain('role="group" aria-label="A demonstration of the Taalcut app: Remix a reel"');
    for (const a of APP_AREAS) expect(html).toContain(`data-area="${a.id}"`);
    expect(html.match(/data-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-area="templates" data-current="true"/);
    expect(html).toContain('data-platform="mac"');
    expect(renderToStaticMarkup(h(AppWindow, { title: 'T', platform: 'ubuntu', sidebar: false, children: null }))).not.toContain('app-window-sidebar');
    expect(APP_WINDOW_WIDTH).toEqual({ sm: 560, md: 760, lg: 960 });
  });

  it('draws the segment bar as one image with its words, or hidden when it is only the motif', () => {
    const html = renderToStaticMarkup(h(SegmentBar, { segments: SEGMENTS, beats: [1, 2, 3], state: 'filled', labels: true, numbers: true }));
    expect(html).toContain('role="img" aria-label="Template: 5 slots');
    expect(html.match(/data-slot="segment"/g)).toHaveLength(5);
    expect(html.match(/data-slot="beat-tick"/g)).toHaveLength(3);
    expect(html).toContain('data-unsure=""');
    expect(html).toContain('>Hook<');
    expect(renderToStaticMarkup(h(SegmentBar, { segments: SEGMENTS, decorative: true }))).toMatch(/^<div aria-hidden="true"/);
  });

  it('puts an icon and its words on one line, the icon hidden', () => {
    const html = renderToStaticMarkup(h(IconText, { icon: Music, tone: 'beat', children: 'Music beats' }));
    expect(html).toMatch(/^<span data-slot="icon-text"[^>]*><span aria-hidden="true" class="[^"]*text-rose-strong/);
    expect(html).toContain('Music beats');
  });
});
