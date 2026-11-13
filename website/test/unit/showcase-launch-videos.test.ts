// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { feature } from '#content/features';
import { LAUNCH_ROWS, LaunchFragment, LaunchShowcase } from '#components/showcase/launch-videos/entry';
import { HINT, LOOK } from '#components/showcase/launch-videos/meta';
import { PASS, passAt, passEnds, passTimes } from '#components/showcase/launch-videos/pass';
import {
  BRIEF,
  changeSeconds,
  clock,
  FORMATS,
  frameShares,
  MAX_SCENES,
  SCENES,
  sceneAt,
  sceneSpans,
  SECONDS_MAX,
  SECONDS_MIN,
  SOURCES,
  sourcesFor,
  TASKS,
  tasksFor,
  toggleFormat,
  totalSeconds,
  VOICES,
} from '#components/showcase/launch-videos/story';
import { framesOf } from '#components/showcase/frames';
import { HERO } from '#components/hero/copy';

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('the launch video’s script', () => {
  it('holds up to 12 scenes, adds up to the brief’s length, and opens and closes on the site’s words', () => {
    expect(SCENES.length).toBeGreaterThan(0);
    expect(SCENES.length).toBeLessThanOrEqual(MAX_SCENES);
    expect(totalSeconds(SCENES)).toBe(BRIEF.seconds);
    expect(clock(totalSeconds(SCENES))).toBe('0:30');
    expect(new Set(SCENES.map((s) => s.look)).size).toBe(SCENES.length);
    expect(SCENES[0]?.words).toBe(HERO.title);
    expect(SCENES.at(-1)?.words).toContain('taalcut.app');
    expect(SCENES[0]?.group).toBe('hook');
    expect(SCENES.at(-1)?.group).toBe('outro');
  });

  it('knows the scene playing at any moment of the video', () => {
    const spans = sceneSpans(SCENES);
    expect(spans[0]).toEqual([0, 5]);
    expect(spans.at(-1)?.[1]).toBe(30);
    expect(sceneAt(SCENES, 0)).toBe(0);
    expect(sceneAt(SCENES, 5)).toBe(1);
    expect(sceneAt(SCENES, 15.4)).toBe(2);
    expect(sceneAt(SCENES, 29.99)).toBe(SCENES.length - 1);
    expect(clock(12.9)).toBe('0:12');
  });

  it('changes a scene’s length in half seconds, between 1 and 12', () => {
    expect(changeSeconds(5, 0.5)).toBe(5.5);
    expect(changeSeconds(5.5, -0.5)).toBe(5);
    expect(changeSeconds(SECONDS_MIN, -0.5)).toBe(SECONDS_MIN);
    expect(changeSeconds(SECONDS_MAX, 0.5)).toBe(SECONDS_MAX);
  });

  it('keeps at least one output format, in the picker’s order, and sets them side by side at equal area', () => {
    const all = FORMATS.map((f) => f.id);
    expect(all).toEqual(['16:9', '9:16', '1:1', '4:5']);
    expect(toggleFormat(['16:9'], '16:9')).toEqual(['16:9']);
    expect(toggleFormat(['4:5'], '16:9')).toEqual(['16:9', '4:5']);
    expect(toggleFormat(all, '9:16')).toEqual(['16:9', '1:1', '4:5']);
    const row = frameShares(all, false);
    expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    // Equal area: each frame's width times its height (width over ratio) is the same.
    const areas = all.map((id, i) => (row[i] ?? 0) ** 2 / (FORMATS.find((f) => f.id === id)?.ratio ?? 1));
    for (const a of areas) expect(a).toBeCloseTo(areas[0] ?? 0);
    const pairs = frameShares(all, true);
    expect((pairs[0] ?? 0) + (pairs[1] ?? 0)).toBeCloseTo(1);
    expect((pairs[2] ?? 0) + (pairs[3] ?? 0)).toBeCloseTo(1);
  });

  it('takes a voice recording as a source only when the voiceover is yours, and skips the voiceover task without one', () => {
    expect(sourcesFor('upload').some((s) => s.kind === 'recording')).toBe(true);
    expect(sourcesFor('connected').some((s) => s.kind === 'recording')).toBe(false);
    expect(tasksFor('none').some((t) => t.role === 'voice')).toBe(false);
    expect(tasksFor('connected')).toHaveLength(TASKS.length);
    expect(VOICES.map((v) => v.label)).toEqual(['Generate a voiceover', 'Use a recording', 'No voiceover']);
  });

  it('uses the owner’s footage for every clip from the library', () => {
    for (const s of SOURCES.filter((x) => x.kind === 'media')) expect(framesOf(s.clipId).length, s.name).toBeGreaterThan(0);
  });
});

describe('the arrival’s pass', () => {
  const n = SCENES.length;

  it('approves first, then designs the video scene by scene, and is ready under five seconds', () => {
    const before = passAt(-1, n);
    expect([before.approved, before.designed, before.ready]).toEqual([false, 0, false]);
    expect(before.task.designer).toBe('queued');
    expect(passAt(PASS.approve - 1, n).approved).toBe(false);
    expect(passAt(PASS.approve, n).approved).toBe(true);
    // Nothing is made before the approval.
    expect(passAt(PASS.design - 1, n).task.designer).toBe('queued');
    expect(passAt(PASS.design, n).designing).toBe(0);
    const end = passAt(passEnds(n).end, n);
    expect(end.ready).toBe(true);
    expect(end.designed).toBe(n);
    expect(end.designing).toBeNull();
    expect(Object.values(end.task).every((s) => s === 'completed')).toBe(true);
    expect(passEnds(n).end).toBeLessThan(5000);
  });

  it('only moves forward, one task working at a time, a scene at a time', () => {
    let last = passAt(0, n);
    for (const at of passTimes(n)) {
      const frame = passAt(at, n);
      expect(frame.designed).toBeGreaterThanOrEqual(last.designed);
      expect(frame.designed - last.designed).toBeLessThanOrEqual(1);
      expect(Object.values(frame.task).filter((s) => s === 'running').length).toBeLessThanOrEqual(1);
      last = frame;
    }
    expect(passTimes(n, PASS.approve)[0]).toBe(PASS.approve);
  });
});

describe('the launch showcase’s words', () => {
  it('hold to the truth ledger and never hedge', () => {
    const copy = strings([BRIEF, SOURCES, SCENES, TASKS, FORMATS.map((f) => f.label), VOICES, HINT]);
    expect(copy.flatMap(claimViolations)).toEqual([]);
    expect(copy.join(' ')).not.toMatch(/\bdrafts?\b|\brender/i);
  });

  it('give a row to each of the feature’s facts', () => {
    expect(LAUNCH_ROWS).toHaveLength(feature('launch-videos').facts.length);
    expect(LOOK.area).toBe('create');
    expect(LOOK.stickers).toHaveLength(3);
  });
});

describe('the server HTML', () => {
  it('leads with the finished video in its four formats, the script approved, and nothing at opacity 0', () => {
    const html = renderToStaticMarkup(h(LaunchShowcase));
    expect(html).toContain('data-showcase="launch-videos"');
    expect(html.match(/data-format="/g)).toHaveLength(FORMATS.length);
    for (const f of FORMATS) expect(html).toContain(`aria-label="${f.label}, scene 1: ${SCENES[0]?.words}"`);
    expect(html).toContain('Your video is ready. Open the editor to make it yours.');
    expect(html).toContain('Version 1 · approved');
    expect(html).toContain('Approve script &amp; design');
    expect(html.match(/data-status="completed"/g)).toHaveLength(TASKS.length);
    expect(html).not.toContain('role="tab"');
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
    for (const r of LAUNCH_ROWS) {
      const scene = renderToStaticMarkup(h(r.Scene, { on: true, from: false, reduce: false, ran: false }));
      expect(scene).toContain('data-slot="vignette"');
      expect(scene).not.toMatch(/opacity:\s*0[;"]/);
    }
  });

  it('gives the index a working fragment: the four formats and the scenes to jump to', () => {
    const html = renderToStaticMarkup(h(LaunchFragment));
    expect(html).toContain('data-showcase="launch-videos-fragment"');
    expect(html.match(/data-format="/g)).toHaveLength(FORMATS.length);
    expect(html.match(/aria-label="Scene \d: /g)).toHaveLength(SCENES.length);
    expect(html).toContain('aria-label="Play the video"');
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
  });
});
