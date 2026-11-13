// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Seek determinism (SPEC HFW1): every sampled frame is drawn in order and again in a shuffled order. What the page
 * computed for every element of every composition (opacity, transform, clip, filter, colours, visibility and box) must
 * be the same in both, exactly. The pictures must be the same too; Chrome rasterises a layer whose transform is
 * animating at a scale it keeps from the frames before, so a picture may differ on antialiased edges only, and a
 * frame whose JPEGs differ is decoded and passes when no channel moves by more than RASTER.channel on more than
 * RASTER.share of the canvas. The report gives how many frames matched byte for byte.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runFfmpeg, type MediaContext } from '@taalcut/media';

/** How far a raster difference may go: channel steps out of 255, and a share of the canvas's pixels. */
export const RASTER = { channel: 24, share: 0.002 } as const;

/** What the check found; its detail says where it failed, or how many frames matched exactly. */
export interface DeterminismOutcome {
  readonly id: 'seekDeterminism';
  readonly status: 'pass' | 'fail';
  readonly detail: string;
}

/** The page expression: every composition element's computed look and box, as one string. */
export const STATE_PROBE = `(() => JSON.stringify(Array.from(document.querySelectorAll('[data-tc-composition], [data-tc-composition] *')).map((e) => {
  const c = getComputedStyle(e);
  const r = e.getBoundingClientRect();
  return [c.opacity, c.transform, c.clipPath, c.filter, c.color, c.backgroundColor, c.fill, c.visibility, c.display,
    Math.round(r.x * 100), Math.round(r.y * 100), Math.round(r.width * 100), Math.round(r.height * 100)].join('|');
})))()`;

export interface DrawnFrame {
  readonly jpeg: Buffer;
  readonly state: string;
}

const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

async function rgb(ctx: MediaContext, dir: string, name: string, jpeg: Buffer): Promise<Buffer | null> {
  const input = join(dir, `${name}.jpg`);
  const output = join(dir, `${name}.rgb`);
  await writeFile(input, jpeg);
  const run = await runFfmpeg(ctx, ['-y', '-i', input, '-f', 'rawvideo', '-pix_fmt', 'rgb24', output], {
    holdsVideoSession: false,
    timeoutMs: 30_000,
  });
  return run.ok ? readFile(output) : null;
}

/** The share of pixels whose largest channel step is over RASTER.channel, or null when either can't be decoded. */
export async function rasterDifference(
  ctx: MediaContext,
  dir: string,
  a: Buffer,
  b: Buffer,
): Promise<number | null> {
  const [left, right] = await Promise.all([rgb(ctx, dir, 'a', a), rgb(ctx, dir, 'b', b)]);
  if (!left || !right || left.length !== right.length) return null;
  let over = 0;
  for (let at = 0; at < left.length; at += 3) {
    const step = Math.max(
      Math.abs(left[at]! - right[at]!),
      Math.abs(left[at + 1]! - right[at + 1]!),
      Math.abs(left[at + 2]! - right[at + 2]!),
    );
    if (step > RASTER.channel) over += 1;
  }
  return over / (left.length / 3);
}

/** The check: states equal everywhere, pictures equal or within raster antialiasing. */
export async function seekDeterminism(
  inOrder: ReadonlyMap<number, DrawnFrame>,
  shuffled: ReadonlyMap<number, DrawnFrame>,
  decode: { readonly ctx: MediaContext; readonly dir: string },
): Promise<DeterminismOutcome> {
  let exact = 0;
  let edges = 0;
  for (const [frame, first] of inOrder) {
    const again = shuffled.get(frame);
    if (!again)
      return { id: 'seekDeterminism', status: 'fail', detail: `frame ${frame} was not drawn again` };
    if (sha(first.state) !== sha(again.state))
      return {
        id: 'seekDeterminism',
        status: 'fail',
        detail: `frame ${frame}: the page's state differs when drawn out of order`,
      };
    if (sha(first.jpeg) === sha(again.jpeg)) {
      exact += 1;
      continue;
    }
    const share = await rasterDifference(decode.ctx, decode.dir, first.jpeg, again.jpeg);
    if (share === null || share > RASTER.share)
      return {
        id: 'seekDeterminism',
        status: 'fail',
        detail: `frame ${frame}: the picture differs when drawn out of order (${share === null ? 'undecodable' : `${(share * 100).toFixed(2)}% of pixels`})`,
      };
    edges += 1;
  }
  return {
    id: 'seekDeterminism',
    status: 'pass',
    detail: `${inOrder.size} frames, states equal; pictures ${exact} identical, ${edges} within raster antialiasing`,
  };
}
