// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** FRM1-MOT: the camera-motion eval set's plan, sources and render graphs (no FFmpeg run here). */
import { describe, expect, it } from 'vitest';
import { MOVE_LABEL, planClips } from '../../src/motion/plan';
import { clipArgs, subjectBox, textureWindows, zoomPlan } from '../../src/motion/render';
import { licenceAllowed, SOURCES } from '../../src/motion/sources';

const backgrounds = SOURCES.flatMap((s) =>
  s.role === 'background' && s.split ? [{ id: s.id, split: s.split }] : [],
);

describe('camera-motion eval plan', () => {
  const clips = planClips(backgrounds, 12);

  it('has at least 200 clips, a held-out split by photo, both aspects and every move', () => {
    expect(clips.length).toBeGreaterThanOrEqual(200);
    const heldout = clips.filter((c) => c.split === 'heldout');
    expect(heldout.length).toBeGreaterThanOrEqual(clips.length / 4);
    const trainPhotos = new Set(clips.filter((c) => c.split === 'train').map((c) => c.background));
    expect(heldout.some((c) => trainPhotos.has(c.background))).toBe(false);
    expect(new Set(clips.map((c) => c.aspect))).toEqual(new Set(['16:9', '9:16']));
    expect(new Set(clips.map((c) => c.move)).size).toBe(Object.keys(MOVE_LABEL).length);
    expect(new Set(clips.map((c) => c.label))).toEqual(
      new Set(['static', 'pan', 'tilt', 'push-in', 'pull-out', 'handheld', 'tracking']),
    );
  });

  it('is the same plan on every build', () => {
    expect(planClips(backgrounds, 12)).toEqual(clips);
  });

  it('keeps every camera path on its photo', () => {
    for (const clip of clips) {
      const { z0, cx0, cy0 } = zoomPlan(clip);
      expect(z0).toBeGreaterThanOrEqual(1.05);
      expect(cx0 - 1 / (2 * z0)).toBeGreaterThanOrEqual(0);
      expect(cy0 + 1 / (2 * z0)).toBeLessThanOrEqual(1);
    }
  });

  it('a moving-subject clip moves its subject and holds the camera', () => {
    const clip = clips.find((c) => c.move === 'staticSubject')!;
    expect(clip.camera).toMatchObject({ pan: 0, tilt: 0, zoom: 0, shake: null });
    const start = subjectBox(clip.subjects[0]!, clip, 0)!;
    const later = subjectBox(clip.subjects[0]!, clip, 0.5);
    expect(later?.x).not.toBeCloseTo(start.x, 3);
  });

  it('renders with the platform software H.264 route and one input per subject', () => {
    const clip = clips.find((c) => c.subjects.length === 1)!;
    const args = clipArgs(
      clip,
      { photo: 'p.jpg', photoSize: { width: 3840, height: 2560 }, sprites: Array(12).fill('s.png') },
      'o.mp4',
    );
    expect(args.filter((a) => a === '-i')).toHaveLength(2);
    expect(args).toContain(process.platform === 'darwin' ? 'h264_videotoolbox' : 'libopenh264');
    if (process.platform === 'darwin')
      expect(args.slice(args.indexOf('-require_sw'), args.indexOf('-require_sw') + 2)).toEqual([
        '-require_sw',
        '1',
      ]);
    expect(args.join(' ')).toContain('zoompan=');
  });
});

describe('sources', () => {
  it('takes CC0 and plain CC BY, never SA or NC', () => {
    expect(licenceAllowed('CC0')).toBe(true);
    expect(licenceAllowed('CC BY 4.0')).toBe(true);
    expect(licenceAllowed('CC BY-SA 4.0')).toBe(false);
    expect(licenceAllowed('CC BY-NC 2.0')).toBe(false);
    expect(licenceAllowed('Public domain')).toBe(false);
  });

  it('picks the most textured window for a sprite', () => {
    const width = 40;
    const height = 40;
    const gray = new Uint8Array(width * height).fill(100);
    for (let y = 0; y < 18; y++) for (let x = 30; x < 39; x++) gray[y * width + x] = (x + y) % 2 ? 0 : 255;
    const [best] = textureWindows(gray, width, height, 1);
    expect(best!.x).toBeGreaterThan(0.5);
  });
});
