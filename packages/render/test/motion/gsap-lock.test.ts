// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pinned GSAP package (SPEC G.1): the installed `gsap` is 3.15.0, every file a composition may load hashes to
 * the lock (so a changed package fails here instead of changing renders), each keeps its licence header, and a
 * composition links only the files its motion uses.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GSAP_LOCK,
  GSAP_VERSION,
  gsapBundlePath,
  gsapDistDir,
  gsapFilesFor,
  type GsapFile,
} from '../../src/motion/gsap-files';
import type { MotionTween } from '../../src/motion/motion-data';

const files = Object.keys(GSAP_LOCK).filter((file): file is GsapFile => file in GSAP_LOCK);
const tween = (to: MotionTween['to'], ease?: string): MotionTween => ({
  targets: { ids: ['a'] },
  at: 0,
  duration: 1,
  from: {},
  to,
  ...(ease ? { ease } : {}),
});

describe('the GSAP lock', () => {
  it('pins the installed package, its version and every file by sha256 and size', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(gsapDistDir(), '..', 'package.json'), 'utf8'));
    expect(manifest).toMatchObject({ name: 'gsap', version: GSAP_VERSION });
    for (const file of files) {
      const bytes = readFileSync(join(gsapDistDir(), file));
      expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(GSAP_LOCK[file].sha256);
      expect(bytes.length, file).toBe(GSAP_LOCK[file].bytes);
    }
  });

  it('ships each file as published: its licence header names the standard licence', () => {
    for (const file of files) {
      const head = readFileSync(join(gsapDistDir(), file), 'utf8').slice(0, 400);
      expect(head, file).toContain('GreenSock');
      expect(head, file).toContain('https://gsap.com/standard-license');
    }
  });

  it('links GSAP always and each plugin only when the motion uses it, never under a …/dist/ path', () => {
    expect(gsapFilesFor({ tweens: [tween({ opacity: 1 })], splits: [] })).toEqual(['gsap.min.js']);
    expect(
      gsapFilesFor({
        tweens: [
          tween({ opacity: 1 }, 'cubic-bezier(0.2, 0, 0.4, 1)'),
          tween({ drawSVG: '0% 100%' }),
          tween({ morphSVG: 'M0 0 L1 1 Z' }),
          tween({ motionPath: { path: 'M0 0 L10 10', autoRotate: true, start: 0, end: 1 } }),
        ],
        splits: [{ id: 'a', type: 'words' }],
      }),
    ).toEqual([
      'gsap.min.js',
      'CustomEase.min.js',
      'SplitText.min.js',
      'DrawSVGPlugin.min.js',
      'MorphSVGPlugin.min.js',
      'MotionPathPlugin.min.js',
    ]);
    for (const file of files) expect(gsapBundlePath(file)).not.toMatch(/\/dist\//);
  });
});
