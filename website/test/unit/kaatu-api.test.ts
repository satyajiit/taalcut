// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Kaatu, KAATU_POKE_LABEL, KAATU_POSES } from '#components/kaatu/kaatu';
import { KaatuMoment } from '#components/kaatu/kaatu-moment';
import { KaatuMoodProvider } from '#components/kaatu/kaatu-context';
import { KAATU_SHEETS, SHEET_NAMES, SHEETS, WEB_SHEETS, locate } from '#components/kaatu/kaatu-frames';
import { directionToward, leanToward } from '#components/kaatu/kaatu-look';
import { POSE_REPEATS, POSES } from '#components/kaatu/kaatu-poses';
import { arrivalSheets, contactSheets } from '#components/kaatu/kaatu-sheets';
import { read, SITE_ROOT } from './source-files';

const FRAMES = new Set<string>(SHEETS.flat());

/** A WebP's canvas size, from its VP8X header (an atlas with alpha always has one). */
function webpSize(path: string): { width: number; height: number } {
  const b = readFileSync(path);
  expect(b.toString('ascii', 0, 4)).toBe('RIFF');
  expect(b.toString('ascii', 8, 12)).toBe('WEBP');
  expect(b.toString('ascii', 12, 16)).toBe('VP8X');
  return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
}

describe('the Kaatu API', () => {
  it('draws every pose the lanes may ask for on its own frame, in the site’s two sheets', () => {
    expect([...KAATU_POSES].sort()).toEqual(Object.keys(POSES).sort());
    const drawn = new Set<string>(WEB_SHEETS.flat());
    for (const pose of KAATU_POSES) {
      const script = POSES[pose];
      expect(script.drawn, pose).toBe(true);
      expect(script.frame, pose).toBe(pose);
      expect(drawn.has(script.frame), pose).toBe(true);
      expect(script.about.length, pose).toBeGreaterThan(20);
      for (const beat of script.act ?? []) expect(FRAMES.has(beat.frame), `${pose} ${beat.frame}`).toBe(true);
    }
    expect(POSES['peek-left'].entrance).toBe('from-left');
    expect(POSES['peek-up'].entrance).toBe('from-below');
  });

  it('keeps every pose’s act well under five seconds of motion (WCAG 2.2.2)', () => {
    for (const pose of KAATU_POSES) {
      const ms = (POSES[pose].act ?? []).reduce((sum, b) => sum + b.ms, 0) * POSE_REPEATS;
      expect(ms, pose).toBeLessThan(5000);
    }
  });

  it('looks toward a near pointer, leans after it, and lets go when it is far', () => {
    expect(directionToward(0, 0, 200, 0)).toBe('right');
    expect(directionToward(0, 0, 0, -200)).toBe('up');
    expect(directionToward(0, 0, -150, 150)).toBe('down-left');
    expect(directionToward(0, 0, 5, 5)).toBe('center');
    expect(directionToward(0, 0, 4000, 0)).toBeNull();
    const [x, , turn] = leanToward(0, 0, 200, 0);
    expect(x).toBeGreaterThan(0);
    expect(turn).toBeGreaterThan(0);
    expect(leanToward(0, 0, 4000, 0)).toEqual([0, 0, 0]);
  });

  it('renders decorative and still in the server HTML: the pose’s own frame, hidden, never focusable', () => {
    const html = renderToStaticMarkup(h(Kaatu, { pose: 'film', size: 80, sticker: true }));
    expect(html).toMatch(/^<span aria-hidden="true" data-slot="kaatu" data-pose="film" data-frame="film"/);
    expect(html).toContain('--kaatu-px:80px');
    expect(html).toContain('tc-kaatu-sticker');
    expect(html).not.toContain('tabindex');
    expect(html).not.toContain('<button');
    // Only the frame's own layer is on, so the server HTML fetches one atlas.
    expect(html.match(/data-on=""/g)).toHaveLength(1);
    expect(html).toMatch(/data-sheet="6" data-cell="0" data-on=""/);
    // The breath waits for the script.
    expect(html).toContain('data-paused=""');
    const mood = renderToStaticMarkup(h(Kaatu, { mood: 'asleep' }));
    expect(mood).toContain('data-mood="asleep"');
    expect(mood).toContain('data-frame="sleepy"');
    expect(mood).toContain('data-breath="asleep"');
  });

  it('is a named button when interactive, with the drawing inside it hidden', () => {
    const html = renderToStaticMarkup(h(Kaatu, { pose: 'big-wave', size: 96, interactive: true, className: 'absolute' }));
    expect(html).toMatch(/^<button type="button" aria-label="Kaatu, Taalcut’s beaver: poke" data-slot="kaatu-poke"/);
    expect(KAATU_POKE_LABEL).toBe('Kaatu, Taalcut’s beaver: poke');
    expect(html).toMatch(/<span aria-hidden="true" data-slot="kaatu" data-pose="big-wave" data-frame="big-wave"/);
    // The caller's placement goes on the button, the outermost box.
    expect(html).toMatch(/^<button[^>]*class="[^"]*absolute/);
  });

  it('marks the peeks for their edge clip, and dancing Kaatu carries its notes', () => {
    expect(renderToStaticMarkup(h(Kaatu, { pose: 'peek-left' }))).toContain('data-entrance="from-left"');
    expect(renderToStaticMarkup(h(Kaatu, { pose: 'peek-up' }))).toContain('data-entrance="from-below"');
    const beat = () => () => undefined;
    const dancing = renderToStaticMarkup(h(Kaatu, { pose: 'headphones', beat }));
    expect(dancing).toContain('data-slot="kaatu-notes"');
    expect(dancing.match(/tc-kaatu-note/g)).toHaveLength(2);
  });

  it('takes its mood from a section when it sets none of its own', () => {
    const inside = renderToStaticMarkup(h(KaatuMoodProvider, { mood: 'thinking', children: h(Kaatu, {}) }));
    expect(inside).toContain('data-mood="thinking"');
    expect(inside).toContain('data-frame="up-left"');
    const own = renderToStaticMarkup(h(KaatuMoodProvider, { mood: 'thinking', children: h(Kaatu, { mood: 'wave' }) }));
    expect(own).toContain('data-mood="wave"');
    expect(renderToStaticMarkup(h(Kaatu, {}))).toContain('data-mood="idle"');
  });

  it('keeps KaatuMoment, the words-beside Kaatu, with its optical inset', () => {
    const html = renderToStaticMarkup(h(KaatuMoment, { mood: 'wave', size: 112 }));
    expect(html).toMatch(/^<span aria-hidden="true" data-slot="kaatu" data-mood="wave" data-frame="wave"/);
    expect(html).toContain('-mx-[20px]');
    expect(html).toContain('--kaatu-px:112px');
  });
});

describe('Kaatu’s atlases', () => {
  it('serves eight 480 px-cell atlases from /kaatu/, each with its provenance', () => {
    expect(KAATU_SHEETS).toHaveLength(SHEETS.length);
    for (const [i, name] of SHEET_NAMES.entries()) {
      expect(KAATU_SHEETS[i]).toBe(`/kaatu/kaatu-${name}.webp`);
      const file = join(SITE_ROOT, 'public', KAATU_SHEETS[i] ?? '');
      expect(webpSize(file), name).toEqual({ width: 1440, height: 1440 });
      const sidecar = JSON.parse(readFileSync(`${file}.json`, 'utf8')) as { prompt: string };
      expect(sidecar.prompt, name).toContain(`design/mascot/prompts/${name}.txt`);
      expect(existsSync(join(SITE_ROOT, '..', 'design/mascot/source', `${name}.png`)), name).toBe(true);
    }
  });

  it('gives kaatu.css a layer for every sheet, and an image only once a layer is on or loaded', () => {
    const css = read('src/components/kaatu/kaatu.css');
    for (const [i, url] of KAATU_SHEETS.entries()) {
      expect(css).toContain(`.tc-kaatu-layer[data-sheet='${i}']:is([data-on], [data-loaded]) { background-image: url('${url}'); }`);
    }
    expect(css).not.toContain('/brand/kaatu/');
  });

  it('loads only what a Kaatu shows: a held pose its own sheet, an idle Kaatu its life, contact the rest', () => {
    expect([...arrivalSheets({ pose: 'peek-left', mood: 'idle', toward: 'right' }, false)]).toEqual([locate('peek-left').sheet]);
    expect([...arrivalSheets({ pose: 'film', mood: 'idle', toward: 'right' }, false)].sort()).toEqual([5, 6]);
    const idle = arrivalSheets({ mood: 'idle', toward: 'right' }, false);
    expect([...idle].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(arrivalSheets({ mood: 'idle', toward: 'right' }, true).has(5)).toBe(true);
    expect([...contactSheets()].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
