// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A clip's picture as one FFmpeg filter graph: each shot's look trimmed to its length at the clip's rate and
 * size with a little sensor grain, its on-screen line laid over it, and the shots joined in order by hard cuts
 * (concat) and dissolves (xfade, overlapping the shot before); a scripted clip's fades through black and low-key
 * shots come from through-black.ts. A portrait clip is drawn upright, then turned a
 * quarter left into the landscape frame phones store (the container's rotation tag turns it back, encode.ts).
 *
 * The graph reads files only for stills (pan, zoom) and text images, as `-i` inputs numbered from 0; the
 * caller prepares them first (`stills`, `texts`).
 */
import { join } from 'node:path';
import type { ClipPlan } from '../plan';
import { lookSource, stillFor, type StillSpec } from './looks';
import { textImage, type TextImage } from './pixel-font';
import { DARK_FILTER, throughBlack } from './through-black';

export interface VideoGraph {
  /** `-i` inputs in order, with their options. */
  readonly inputArgs: readonly string[];
  readonly inputs: number;
  /** Ends in the label `[v]`. */
  readonly filter: string;
  readonly stills: readonly (StillSpec & { readonly path: string })[];
  readonly texts: readonly (TextImage & { readonly path: string })[];
}

/** The text's scale: about 6% of the picture's height, and never wider than 90% of it. */
function textScale(image: TextImage, width: number, height: number): number {
  return Math.max(
    1,
    Math.min(Math.floor((height * 0.06) / image.height), Math.floor((width * 0.9) / image.width)),
  );
}

/**
 * The shots joined in order onto `chains`: hard cuts (concat), dissolves (xfade over the shot before) and scripted
 * clips' fades through black; the joined picture's label.
 */
function joinShots(plan: ClipPlan, label: (index: number) => string, chains: string[]): string {
  const { width, height, fps } = plan.clip;
  let joined = label(0);
  let length = plan.shots[0]?.seconds ?? 0;
  for (let index = 1; index < plan.shots.length; index += 1) {
    const shot = plan.shots[index];
    if (shot === undefined) continue;
    const out = `[join${index}]`;
    if (shot.dissolve > 0) {
      const offset = Math.round((length - shot.dissolve) * 1000) / 1000;
      chains.push(
        `${joined}${label(index)}xfade=transition=fade:duration=${shot.dissolve}:offset=${offset}${out}`,
      );
      length = offset + shot.seconds;
    } else if (shot.fade !== undefined) {
      const picture = { width, height, fps };
      chains.push(
        ...throughBlack({ before: joined, length, next: label(index), fade: shot.fade, index, picture }, out),
      );
      length += shot.fade.hold + shot.seconds;
    } else {
      chains.push(`${joined}${label(index)}concat=n=2:v=1:a=0${out}`);
      length += shot.seconds;
    }
    joined = out;
  }
  return joined;
}

export function videoGraph(plan: ClipPlan, workDir: string): VideoGraph {
  const { width, height, fps } = plan.clip;
  const inputArgs: string[] = [];
  const stills: (StillSpec & { path: string })[] = [];
  const texts: (TextImage & { path: string })[] = [];
  const chains: string[] = [];
  let inputs = 0;
  plan.shots.forEach((shot, index) => {
    const context = { width, height, fps, seconds: shot.seconds, seed: shot.seed };
    const look = lookSource(shot.look, context);
    let head: string;
    if (look.source !== null) head = look.source;
    else {
      const still = { ...stillFor(context), path: join(workDir, `still-${index}.jpg`) };
      stills.push(still);
      inputArgs.push('-loop', '1', '-framerate', String(fps), '-t', String(shot.seconds), '-i', still.path);
      head = `[${inputs}:v]${look.onStill}`;
      inputs += 1;
    }
    const grain =
      `noise=alls=4:allf=t:all_seed=${shot.seed % 1_000_000}` + (shot.dark === true ? `,${DARK_FILTER}` : '');
    chains.push(
      `${head},trim=duration=${shot.seconds},setpts=PTS-STARTPTS,fps=${fps},` +
        `scale=${width}:${height}:flags=${look.scaleFlags},format=yuv420p,setsar=1,${grain},settb=AVTB[shot${index}]`,
    );
    if (shot.text !== null) {
      const image = { ...textImage(shot.text.line), path: join(workDir, `text-${index}.ppm`) };
      texts.push(image);
      inputArgs.push('-i', image.path);
      const scale = textScale(image, width, height);
      chains.push(
        `[${inputs}:v]scale=${image.width * scale}:${image.height * scale}:flags=neighbor,format=yuv420p[text${index}]`,
        `[shot${index}][text${index}]overlay=x=(W-w)/2:y=H*0.78:enable='between(t,${shot.text.from},${shot.text.to})'[shot${index}t]`,
      );
      inputs += 1;
    }
  });
  const label = (index: number) => (plan.shots[index]?.text ? `[shot${index}t]` : `[shot${index}]`);
  const joined = joinShots(plan, label, chains);
  // Portrait: upright → a quarter turn left, stored landscape; the rotation tag (-90) shows it upright again.
  chains.push(`${joined}${plan.clip.height > plan.clip.width ? 'transpose=2,' : ''}format=yuv420p[v]`);
  return { inputArgs, inputs, filter: chains.join(';'), stills, texts };
}
