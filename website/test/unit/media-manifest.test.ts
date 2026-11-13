// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEDIA } from '../../src/content/media.gen';
import { CAMERA_ROLL, DEFAULT_REEL_ID, REEL_WORDS, REELS, ROLL_FRAMES, SHELF_MIN, reelById, rollClipLoop } from '../../src/content/reels';
import { SITE_ROOT } from './source-files';

const MB = 1024 * 1024;
const servedFiles = [
  ...MEDIA.reels.flatMap((r) => [...r.poster, ...r.reference, ...r.made]),
  ...MEDIA.roll.clips.flatMap((c) => c.loop),
  ...(MEDIA.roll.atlas ? [MEDIA.roll.atlas] : []),
];
const onDisk = (src: string) => join(SITE_ROOT, 'public', src);

/** An MP4's handler types (hdlr boxes): 'vide' for a video track, 'soun' for sound. */
function handlers(file: string): string[] {
  const bytes = readFileSync(file);
  const found: string[] = [];
  for (let i = bytes.indexOf('hdlr'); i !== -1; i = bytes.indexOf('hdlr', i + 4)) found.push(bytes.toString('latin1', i + 12, i + 16));
  return found;
}

describe('the media budget', () => {
  // WEB2 raised it for quality, WEB3 for a second reel at 60 fps, WEB4 for a third reel and its raw clips, with the
  // reason recorded.
  it('keeps the whole set under 80 MB and every loop under 4 MB, and says why', () => {
    expect(MEDIA.budget).toMatchObject({ total: 80 * MB, loop: 4 * MB });
    expect(MEDIA.budget.reason ?? '').toMatch(/60 fps/i);
    expect(MEDIA.budget.reason ?? '').toMatch(/third reel/i);
    expect(MEDIA.totalBytes).toBeLessThanOrEqual(80 * MB);
    for (const clip of MEDIA.roll.clips) for (const loop of clip.loop) expect(loop.bytes, loop.src).toBeLessThanOrEqual(4 * MB);
  });

  it('makes each reel at 1080×1920 (60 fps at about 10 Mbps from a 60 fps source, else 30 at 7), its loops at 720×1280 around 3 Mbps, and posters at 1080 and 540', () => {
    for (const r of MEDIA.reels) {
      const smooth = r.sourceSize.fps >= 50;
      for (const v of r.reference) expect([v.width, v.height, v.fps, v.kbps], v.src).toEqual([1080, 1920, smooth ? 60 : 30, smooth ? 10000 : 7000]);
      expect(r.poster.map((p) => p.width)).toEqual([1080, 540]);
    }
    for (const c of MEDIA.roll.clips) for (const v of c.loop) expect([v.width, v.height, v.kbps], v.src).toEqual([720, 1280, 3000]);
  });

  it('never ships a frame larger than its source', () => {
    for (const r of MEDIA.reels) {
      const videos = [...r.reference, ...r.made, ...MEDIA.roll.clips.filter((c) => c.reelId === r.id).flatMap((c) => c.loop)];
      for (const v of [...videos, ...r.poster]) {
        expect(v.width, v.src).toBeLessThanOrEqual(r.sourceSize.width);
        expect(v.height, v.src).toBeLessThanOrEqual(r.sourceSize.height);
      }
      if (MEDIA.roll.atlas) expect(MEDIA.roll.atlas.cell[0] ?? 0).toBeLessThanOrEqual(r.sourceSize.width);
    }
  });

  it('records every served file at its real size', () => {
    let total = 0;
    for (const f of servedFiles) {
      expect(existsSync(onDisk(f.src)), f.src).toBe(true);
      expect(statSync(onDisk(f.src)).size, f.src).toBe(f.bytes);
      total += f.bytes;
    }
    expect(total).toBe(MEDIA.totalBytes);
  });

  it('serves video with no sound track and no location or maker tags', () => {
    for (const f of servedFiles.filter((s) => s.src.endsWith('.mp4'))) {
      expect(handlers(onDisk(f.src)), f.src).not.toContain('soun');
      const text = readFileSync(onDisk(f.src)).toString('latin1');
      expect(text, f.src).not.toMatch(/©xyz|com\.apple\.quicktime\.(location|make|model)|Lavc|hevc_videotoolbox/);
    }
  });
});

describe('the reels and the roll', () => {
  it('has words for every encoded reel', () => {
    for (const r of MEDIA.reels) {
      const words = REEL_WORDS[r.id];
      expect(words, r.id).toBeDefined();
      expect(words?.shots.length, r.id).toBe(r.shots.length);
      for (const [needs, reason] of words?.shots ?? []) expect(needs.length * reason.length, r.id).toBeGreaterThan(0);
    }
    expect(REELS.filter((r) => !r.placeholder).length).toBe(MEDIA.reels.length);
    expect(REELS.length).toBeGreaterThanOrEqual(SHELF_MIN);
    for (const r of REELS.filter((p) => p.placeholder)) expect([r.poster, r.reference.length, r.slots.length], r.id).toEqual(['', 0, 0]);
  });

  it('builds each reel from its own cuts and beats', () => {
    for (const reel of REELS.filter((r) => !r.placeholder)) {
      expect(reel.id).toMatch(/^[a-z-]+$/);
      expect(reel.tempo).toBeGreaterThanOrEqual(60);
      expect(reel.tempo).toBeLessThanOrEqual(180);
      expect([...reel.beats].sort((a, b) => a - b)).toEqual(reel.beats);
      expect(reel.beats.every((b) => b >= 0 && b < reel.durationSec)).toBe(true);
      expect(reel.slots[0]?.start).toBe(0);
      reel.slots.forEach((s, i) => {
        expect(s.end, s.id).toBeGreaterThan(s.start);
        if (i > 0) expect(s.start, s.id).toBe(reel.slots[i - 1]?.end);
        expect(rollClipLoop(s.pick.clipId).length, s.pick.clipId).toBeGreaterThan(0);
      });
      expect(reel.slots.at(-1)?.end).toBeCloseTo(reel.durationSec, 1);
      expect(reel.slots[0]?.role).toBe('hook');
      expect(reel.slots.at(-1)?.role).toBe('outro');
      expect(reel.reference.length).toBeGreaterThan(0);
      expect(reel.poster).toMatch(/^\/media\/reels\/[a-z-]+\/poster\.webp$/);
    }
    expect(reelById('no-such-reel').id).toBe(DEFAULT_REEL_ID);
    expect(reelById(DEFAULT_REEL_ID).placeholder).toBeUndefined();
  });

  it('points every roll clip at a frame in the atlas', () => {
    const cells = CAMERA_ROLL.atlas.columns * CAMERA_ROLL.atlas.rows;
    // Cells twice the 126 px a roll thumbnail shows at.
    expect(CAMERA_ROLL.atlas.cell).toEqual([252, 448]);
    expect(CAMERA_ROLL.atlas.columns).toBe(16);
    for (const c of CAMERA_ROLL.clips) {
      expect(c.sprite, c.id).toBeLessThan(cells);
      expect(c.day, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(ROLL_FRAMES.some((f) => f.sprite === c.sprite && f.clipId === c.id), c.id).toBe(true);
    }
    expect(ROLL_FRAMES.length).toBeLessThanOrEqual(cells);
  });
});
