// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { feature } from '#content/features';
import { SAMPLE_ROLL } from '#components/showcase/auto-pick/roll';
import { SHORTS_ROWS } from '#components/showcase/shorts/entry';
import { chosenLength } from '#components/showcase/shorts/make-dialog';
import { HINT, LOOK } from '#components/showcase/shorts/meta';
import {
  clock,
  customLength,
  DEFAULT_LENGTH,
  LENGTHS,
  lengthWords,
  LINES,
  lineSpan,
  LONG_SECONDS,
  LONG_VIDEO,
  MAX_LENGTH,
  MIN_LENGTH,
  pickShort,
  playAt,
  runTimes,
  SCENES,
  shortSeconds,
} from '#components/showcase/shorts/trip';
import { REPO_ROOT } from './source-files';

const dialog = readFileSync(join(REPO_ROOT, 'apps/renderer/src/features/shorts/make-short-button.tsx'), 'utf8');
const request = readFileSync(join(REPO_ROOT, 'apps/renderer/src/features/shorts/short-request.ts'), 'utf8');
const dialogSource = readFileSync(join(REPO_ROOT, 'website/src/components/showcase/shorts/make-dialog.tsx'), 'utf8');

describe('Make a short in the app’s words', () => {
  it('uses the dialog’s own words, and the app’s length rule', () => {
    for (const words of [
      'Make a short',
      'Turn one long video into a portrait story with captions and your branding.',
      'Target length',
      'Custom',
      'Length in seconds',
      'Choose a whole number from 15 to 179 seconds.',
      'The final cut may be shorter to keep the story complete.',
      'Cancel',
      'Create short',
    ]) {
      expect(dialog, words).toContain(words);
      expect(dialogSource, words).toContain(words);
    }
    expect(dialog).toContain('[30, 60, 90]');
    expect(dialog).toContain(`useState('${DEFAULT_LENGTH}')`);
    expect(request).toContain(`seconds >= ${MIN_LENGTH} && seconds <= ${MAX_LENGTH}`);
    expect([...LENGTHS]).toEqual([30, 60, 90]);
    expect(lengthWords(30)).toBe('30 sec');
  });

  it('takes a custom length only as a whole number from 15 to 179', () => {
    expect(customLength('15')).toBe(15);
    expect(customLength('179')).toBe(179);
    for (const bad of ['', ' ', '14', '180', '60.5', 'sixty', '-30']) expect(customLength(bad), bad).toBeNull();
    expect(chosenLength('90', 'x')).toBe(90);
    expect(chosenLength('custom', '45')).toBe(45);
    expect(chosenLength('custom', '200')).toBeNull();
  });
});

describe('the long video', () => {
  it('is the owner’s clips end to end, each once, from all three trips, 14:08 long', () => {
    const roll = new Set(SAMPLE_ROLL.map((c) => c.id));
    expect(SCENES).toHaveLength(22);
    expect(SCENES.every((s) => roll.has(s.clipId))).toBe(true);
    expect(new Set(SCENES.map((s) => s.clipId)).size).toBe(SCENES.length);
    for (const trip of ['airport-', 'vietnam-', 'repeat-']) expect(SCENES.some((s) => s.clipId.startsWith(trip)), trip).toBe(true);
    for (const [i, s] of SCENES.entries()) if (i > 0) expect(s.at).toBe((SCENES[i - 1]?.at ?? 0) + (SCENES[i - 1]?.seconds ?? 0));
    expect(clock(LONG_SECONDS)).toBe('14:08');
    expect(LONG_VIDEO.length).toBeGreaterThan(5);
  });

  it('has its narration as whole sentences over neighbouring scenes, each scene once, in order', () => {
    const covered = LINES.flatMap((l) => l.scenes);
    expect(covered).toEqual(SCENES.map((_, i) => i));
    for (const line of LINES) {
      expect(line.text, line.id).toMatch(/^[A-Z].*[.!?]$/);
      const [from, to] = lineSpan(line);
      expect(to, line.id).toBeGreaterThan(from);
    }
    expect(LINES.filter((l) => l.role === 'hook')).toHaveLength(1);
    expect(LINES.filter((l) => l.role === 'payoff')).toHaveLength(1);
  });
});

describe('picking the short', () => {
  const targets = [15, 30, 45, 60, 90, 120, 179];

  it('never runs over the target, keeps whole sentences, and opens on the hook and ends on the payoff', () => {
    for (const target of targets) {
      const picks = pickShort(target);
      expect(shortSeconds(picks), String(target)).toBeLessThanOrEqual(target);
      expect(picks[0]?.role).toBe('hook');
      expect(picks[picks.length - 1]?.role).toBe('payoff');
      expect(picks.slice(1, -1).every((p) => p.role === 'context')).toBe(true);
      const order = picks.map((p) => LINES.indexOf(p.line));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it('may run shorter to end whole, and takes more context as the target grows', () => {
    expect(shortSeconds(pickShort(30))).toBeLessThan(30);
    expect(shortSeconds(pickShort(60))).toBeLessThan(60);
    let last = 0;
    for (const target of targets) {
      const count = pickShort(target).length;
      expect(count).toBeGreaterThanOrEqual(last);
      last = count;
    }
    expect(pickShort(15)).toHaveLength(2);
    expect(pickShort(179)).toHaveLength(LINES.length);
  });

  it('plays the picks in turn, word by word', () => {
    const picks = pickShort(60);
    const first = playAt(picks, 0);
    expect(first?.index).toBe(0);
    expect(first?.word).toBe(0);
    const late = playAt(picks, (picks[0]?.line.seconds ?? 0) - 0.7);
    expect(late?.word).toBe((late?.words.length ?? 1) - 1);
    const second = playAt(picks, (picks[0]?.line.seconds ?? 0) + 0.01);
    expect(second?.index).toBe(1);
    expect(playAt(picks, shortSeconds(picks) + 5)?.index).toBe(picks.length - 1);
    const roll = new Set(SAMPLE_ROLL.map((c) => c.id));
    for (let t = 0; t < shortSeconds(picks); t += 0.5) expect(roll.has(playAt(picks, t)?.clipId ?? '')).toBe(true);
  });

  it('makes the short in a run under five seconds: marks, then the gather, then the check', () => {
    for (const count of [2, 4, 9, 12]) {
      const t = runTimes(count);
      expect(t.marks).toHaveLength(count);
      expect(Math.max(...t.marks)).toBeLessThan(Math.min(...t.gathers));
      expect(Math.max(...t.gathers)).toBeLessThan(t.checking);
      expect(t.checking).toBeLessThan(t.passed);
      expect(t.end).toBeLessThan(5000);
    }
  });
});

describe('the page’s parts', () => {
  it('give each fact its icon and scene, in order', () => {
    expect(SHORTS_ROWS).toHaveLength(feature('shorts').facts.length);
  });

  it('look the part: violet for the AI’s pick, the library, Kaatu holding up a reel', () => {
    expect(LOOK).toMatchObject({ job: 'ai', area: 'library', pose: 'hold-reel' });
  });

  it('hold to the truth ledger: one short, portrait, YouTube the only link, nothing promised for every video', () => {
    const words = [...LINES.map((l) => l.text), LONG_VIDEO, HINT.title, String(HINT.hint)];
    expect(words.flatMap(claimViolations)).toEqual([]);
    const all = words.join(' ');
    expect(all).not.toMatch(/\bshorts per\b|\bbatch|\blandscape\b|\bevery video\b|\bvimeo\b|\btiktok link/i);
  });
});
