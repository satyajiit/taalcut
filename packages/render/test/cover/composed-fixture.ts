// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CVR2 fixtures: made-up footage to design covers over (a ridge under a low sun, drawn by FFmpeg: no person's
 * media), and a cover's composition as the timeline keeps it, written to a test workspace's blobs.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  compositionHash,
  coverLeadSource,
  coverSettingsSchema,
  workspaceBlobPath,
  type CoverMedium,
  type CoverPicture,
  type CoverSettings,
  type ProjectId,
  type ThumbnailAspect,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { gateComposition } from '../../src/workspace/gate/workspace-gate';
import { ffmpeg } from '../support/media';
import { FIXTURE_H264 } from '../support/host-video';

export const COMPOSITIONS = join(import.meta.dirname, 'compositions');

export interface Scene {
  /** Sky at the top and at the horizon, the far ridge and the near one, as r, g, b. */
  readonly top: readonly [number, number, number];
  readonly horizon: readonly [number, number, number];
  readonly far: readonly [number, number, number];
  readonly near: readonly [number, number, number];
  /** The sun's centre, as shares of the frame. */
  readonly sun: readonly [number, number];
}

export const DUSK: Scene = {
  top: [18, 28, 64],
  horizon: [250, 150, 70],
  far: [78, 54, 88],
  near: [18, 20, 32],
  sun: [0.68, 0.53],
};
export const DAWN: Scene = {
  top: [96, 150, 214],
  horizon: [255, 224, 196],
  far: [104, 128, 170],
  near: [40, 56, 86],
  sun: [0.3, 0.56],
};

/** One channel of the scene as a geq expression: sky and sun above the ridges, each ridge its own colour. */
function channel(scene: Scene, index: 0 | 1 | 2): string {
  const sky = `${scene.top[index]}+${scene.horizon[index] - scene.top[index]}*pow(clip(Y/(0.62*H),0,1),1.5)`;
  const glow = `${[255, 225, 160][index]}*exp(-(pow(X-${scene.sun[0]}*W,2)+pow(Y-${scene.sun[1]}*H,2))/(2*pow(0.085*W,2)))`;
  const far = '0.585*H+0.028*H*sin(X/38)+0.016*H*sin(X/11+1.3)';
  const near = '0.70*H+0.05*H*sin(X/75+2)+0.012*H*sin(X/9)';
  return `if(gt(Y,${near}),${scene.near[index]}*(1-0.5*(Y-0.7*H)/(0.3*H)),if(gt(Y,${far}),${scene.far[index]},clip(${sky}+${glow},0,255)))`;
}

/** A two-second 1080×1920 clip of the scene (one drawn frame, held), with silence. */
export async function sceneClip(ctx: MediaContext, out: string, scene: Scene): Promise<void> {
  const still = `${out}.png`;
  const draw = `geq=r='${channel(scene, 0)}':g='${channel(scene, 1)}':b='${channel(scene, 2)}'`;
  await ffmpeg(ctx, [
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=540x960:r=30,format=rgb24,${draw},scale=1080:1920:flags=bicubic`,
    '-frames:v',
    '1',
    still,
  ]);
  await ffmpeg(ctx, [
    '-loop',
    '1',
    '-framerate',
    '30',
    '-i',
    still,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-frames:v',
    '60',
    '-c:v',
    FIXTURE_H264,
    '-b:v',
    '12M',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    out,
  ]);
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export interface ComposedSpec {
  readonly aspect: ThumbnailAspect;
  readonly pictures: readonly CoverPicture[];
  readonly medium?: CoverMedium;
  readonly params?: Record<string, string>;
}

/** `html` in the workspace at `root` as index.html, and the cover that is drawn from it. */
export async function composedCover(
  root: string,
  projectId: ProjectId,
  html: string,
  spec: ComposedSpec,
): Promise<CoverSettings> {
  const blob = join(root, workspaceBlobPath(projectId, sha(html)));
  await mkdir(join(blob, '..'), { recursive: true });
  await writeFile(blob, html);
  const files = [{ path: 'cover/index.html', sha256: sha(html), bytes: Buffer.byteLength(html) }];
  const gated = await gateComposition({ entry: 'cover/index.html', files: [{ ...files[0]!, text: html }] });
  return coverSettingsSchema.parse({
    aspect: spec.aspect,
    source: coverLeadSource(spec.pictures),
    medium: spec.medium ?? 'footage',
    composition: {
      entry: 'cover/index.html',
      files,
      hash: await compositionHash(files),
      variables: gated.variables,
      params: spec.params ?? {},
      at: 1,
      pictures: spec.pictures,
      idea: 'A test cover',
    },
  });
}

export const compositionText = (name: string) => readFile(join(COMPOSITIONS, name), 'utf8');
