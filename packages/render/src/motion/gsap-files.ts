// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The GSAP files a composition loads (SPEC G.1): the official `gsap` package's own minified builds, as published,
 * linked into the bundle at `vendor/gsap/<file>` and served from there to the preview and the export. Never the
 * network: the path is a bundle file, and it never has the `…gsap…/dist/…` shape HyperFrames' producer would
 * rewrite to a CDN. The lock pins each file's sha256; `test/motion/gsap-lock.test.ts` checks the installed package
 * against it, and the hash is the link's key, so the files are part of the composition hash.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { MotionPart, MotionTween } from './motion-data';
import { CUBIC_BEZIER } from './motion-data';

export const GSAP_VERSION = '3.15.0';

/** Each file a composition may load, with its sha256 and size in the pinned package. */
export const GSAP_LOCK = {
  'gsap.min.js': {
    sha256: '92bb9a96476f983d212a2bc4f54c889039c1696dd4461d40a736860938570fbb',
    bytes: 72_927,
  },
  'CustomEase.min.js': {
    sha256: '466e426a5c60c21c94b15a30a3dffacac9bb39ce8f4e07d071d7d4bb1be43390',
    bytes: 7_143,
  },
  'SplitText.min.js': {
    sha256: '419f7027a5f086a12cb7988736d8fdd3a6ed2200229661de25b6628ca7ced344',
    bytes: 7_732,
  },
  'DrawSVGPlugin.min.js': {
    sha256: 'beb19529f54c1212f1f5117d027be01afda2f363a4926d32aa979bc11140edc1',
    bytes: 4_351,
  },
  'MorphSVGPlugin.min.js': {
    sha256: '19c891a412240d8521b13330813d9b551ea5b0f707907c365ffecaf1dfa0f5cf',
    bytes: 21_195,
  },
  'MotionPathPlugin.min.js': {
    sha256: 'ace44a07c6c179f5347d9b46a152d468e4c9f272ee0d68bf0354e00d60000693',
    bytes: 22_002,
  },
} as const;
export type GsapFile = keyof typeof GSAP_LOCK;

/** Where a file goes in the bundle (and the `<script src>` that loads it). */
export const gsapBundlePath = (file: GsapFile) => `vendor/gsap/${file}`;

let distDir: string | undefined;

/** The installed package's `dist` folder (inside app.asar when packaged: the bundle writer copies from there). */
export function gsapDistDir(): string {
  distDir ??= join(dirname(createRequire(import.meta.url).resolve('gsap/package.json')), 'dist');
  return distDir;
}

const usesProperty = (tweens: readonly MotionTween[], property: 'drawSVG' | 'morphSVG' | 'motionPath') =>
  tweens.some((tween) => property in tween.to || property in tween.from);

/** The files a composition's motion needs, in load order: GSAP itself first, then each plugin it uses. */
export function gsapFilesFor(motion: MotionPart): GsapFile[] {
  const files: GsapFile[] = ['gsap.min.js'];
  if (motion.tweens.some((tween) => tween.ease !== undefined && CUBIC_BEZIER.test(tween.ease)))
    files.push('CustomEase.min.js');
  if (motion.splits.length > 0) files.push('SplitText.min.js');
  if (usesProperty(motion.tweens, 'drawSVG')) files.push('DrawSVGPlugin.min.js');
  if (usesProperty(motion.tweens, 'morphSVG')) files.push('MorphSVGPlugin.min.js');
  if (usesProperty(motion.tweens, 'motionPath')) files.push('MotionPathPlugin.min.js');
  return files;
}
