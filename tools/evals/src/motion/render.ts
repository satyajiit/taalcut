// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FFmpeg graphs for the camera-motion eval set (FRM1-MOT): a source photo, cropped to the clip's aspect, becomes a
 * shot whose camera moves along the plan's path (zoompan for the pan, tilt and zoom, rotate for a hand's roll, all
 * as closed-form expressions of the frame number), with the moving subjects laid over it and a sensor's noise. The
 * photo is scaled to 4320 px first, so zoompan's whole-pixel crop moves a quarter of an output pixel at most.
 *
 * Encoded through the platform's software H.264 route at a high rate, keeping fixture generation off the app's
 * hardware video sessions. Keep generated fixtures for comparisons; encoder output can differ across OS versions.
 */
import { softwareEncoderFor, videoEncodeFlags } from '@taalcut/media';
import type { ClipPlan, Shake, SubjectPath } from './plan';

/** The zoompan frame is this much larger than the clip, so a hand's roll never shows a corner. */
export const MARGIN = 1.08;
/** zoompan's input long side. */
const WORK_LONG_SIDE = 4320;
/** The ease of a move that starts from rest, seconds. */
const EASE_SECONDS = 0.3;
/** A sprite's width over its height. */
export const SPRITE_ASPECT = 0.5;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
/** The even number at or under n: a crop never asks for more than the photo has. */
const evenDown = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const num = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(8)).toString() : '0');

/** Seconds of the frame `on` (zoompan) or `n` (rotate), as an FFmpeg expression. */
const time = (variable: string, fps: number) => `(${variable}/${fps})`;

/** Distance travelled at unit speed by time t: t, or the eased start's t − τ(1 − e^(−t/τ)). */
function travelled(t: string, ease: boolean): string {
  return ease ? `(${t}-${EASE_SECONDS}*(1-exp(-${t}/${EASE_SECONDS})))` : t;
}

/** Each sine's amplitude for three summed sines to have this RMS. */
const sineAmplitude = (rms: number) => rms / Math.sqrt(1.5);

function sines(t: string, amplitude: number, waves: readonly (readonly [number, number])[]): string {
  if (amplitude === 0) return '0';
  return `(${waves.map(([hz, phase]) => `${num(amplitude)}*sin(${num(2 * Math.PI * hz)}*${t}+${num(phase)})`).join('+')})`;
}

export interface ZoomPlan {
  /** zoompan's zoom at t = 0. */
  readonly z0: number;
  /** The window's centre at t = 0, as shares of the cropped photo. */
  readonly cx0: number;
  readonly cy0: number;
}

/** Where the camera starts so its whole path stays on the photo. */
export function zoomPlan(clip: ClipPlan): ZoomPlan {
  const { pan, tilt, zoom, shake } = clip.camera;
  const T = clip.seconds;
  const shakeRoom = shake ? 4 * shake.rms * Math.max(1, clip.width / clip.height) : 0;
  const along = Math.max(Math.abs(pan), Math.abs(tilt)) * T;
  // Room needed beyond the window, in windows: the travel (plus the shake), and 5% to spare.
  let z0 = (1.05 + along / MARGIN) / (1 - Math.min(0.3, shakeRoom));
  if (zoom < 0) z0 *= Math.exp(-zoom * T);
  if (clip.move === 'static' || clip.move === 'staticSubject') z0 = 1.1;
  const half = 1 / (2 * z0);
  const start = (velocity: number, rng: number) => {
    if (velocity > 0) return half + 0.01;
    if (velocity < 0) return 1 - half - 0.01;
    return 0.5 + (rng - 0.5) * Math.max(0, 1 - 2 * half - 0.02);
  };
  // A fixed "random" placement per clip, from its id, so still shots don't all sit at the centre.
  let h = 0;
  for (const char of clip.id) h = (h * 31 + char.charCodeAt(0)) >>> 0;
  return { z0, cx0: start(pan, (h % 997) / 997), cy0: start(tilt, (h % 991) / 991) };
}

function shakeTerms(t: string, shake: Shake | null, aspect: number) {
  if (!shake) return { x: '0', y: '0', roll: '0' };
  const amplitude = sineAmplitude(shake.rms);
  return {
    // In frame widths; y in frame heights (the same pixels as x).
    x: sines(t, amplitude, shake.x),
    y: sines(t, amplitude * aspect, shake.y),
    roll: sines(t, sineAmplitude((shake.rollDegrees * Math.PI) / 180), shake.roll),
  };
}

/** The camera's zoompan and rotate filters for the clip, on a photo already cropped to its aspect. */
export function cameraFilters(clip: ClipPlan): string[] {
  const { z0, cx0, cy0 } = zoomPlan(clip);
  const { pan, tilt, zoom, ease } = clip.camera;
  const frames = Math.round(clip.seconds * clip.fps);
  const t = time('on', clip.fps);
  const moved = travelled(t, ease);
  const aspect = clip.width / clip.height;
  const shake = shakeTerms(t, clip.camera.shake, aspect);
  // A frame width is 1 / (MARGIN · zoom) of the photo; the pan is measured at the start's zoom.
  const toPhoto = 1 / (MARGIN * z0);
  const z = zoom === 0 ? num(z0) : `${num(z0)}*exp(${num(zoom)}*${moved})`;
  const cx = `(${num(cx0)}+${num(pan * toPhoto)}*${moved}+${num(toPhoto)}*${shake.x})`;
  const cy = `(${num(cy0)}+${num(tilt * toPhoto)}*${moved}+${num(toPhoto)}*${shake.y})`;
  const zw = even(clip.width * MARGIN);
  const zh = even(clip.height * MARGIN);
  const filters = [
    `zoompan=z='${z}':x='${cx}*iw-iw/zoom/2':y='${cy}*ih-ih/zoom/2':d=${frames}:s=${zw}x${zh}:fps=${clip.fps}`,
  ];
  if (clip.camera.shake) {
    const roll = shakeTerms(time('n', clip.fps), clip.camera.shake, aspect).roll;
    filters.push(`rotate=a='${roll}':ow=iw:oh=ih:c=black:bilinear=1`);
  }
  filters.push(`crop=${clip.width}:${clip.height}`);
  return filters;
}

/** A subject's centre at time t (seconds), as shares of the frame. */
export function subjectCentre(subject: SubjectPath, t: number): { x: number; y: number } {
  return {
    x: subject.x + subject.vx * t + subject.wander * Math.sin(2 * Math.PI * 0.4 * t + subject.sprite),
    y: subject.y + subject.vy * t + subject.bob * Math.sin(2 * Math.PI * subject.bobHz * t),
  };
}

/** The same centre as an overlay expression in pixels (top left of the sprite). */
function subjectExpression(subject: SubjectPath, clip: ClipPlan): { x: string; y: string; height: number } {
  const height = even(subject.height * clip.height);
  const width = even(height * SPRITE_ASPECT);
  const W = clip.width;
  const H = clip.height;
  const x = `(${num(subject.x)}+${num(subject.vx)}*t+${num(subject.wander)}*sin(${num(2 * Math.PI * 0.4)}*t+${subject.sprite}))*${W}-${width / 2}`;
  const y = `(${num(subject.y)}+${num(subject.vy)}*t+${num(subject.bob)}*sin(${num(2 * Math.PI * subject.bobHz)}*t))*${H}-${height / 2}`;
  return { x, y, height };
}

/** The subject's box at time t: shares of the frame, top left, cut to the frame; null when it is off the frame. */
export function subjectBox(
  subject: SubjectPath,
  clip: ClipPlan,
  t: number,
): { x: number; y: number; width: number; height: number } | null {
  const centre = subjectCentre(subject, t);
  const height = even(subject.height * clip.height) / clip.height;
  const width = (even(subject.height * clip.height) * SPRITE_ASPECT) / clip.width;
  const x0 = Math.max(0, centre.x - width / 2);
  const x1 = Math.min(1, centre.x + width / 2);
  const y0 = Math.max(0, centre.y - height / 2);
  const y1 = Math.min(1, centre.y + height / 2);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** The photo's crop to the clip's aspect: its centre band, as large as fits. */
function aspectCrop(clip: ClipPlan, photo: { width: number; height: number }): string {
  const target = clip.width / clip.height;
  const fitsWidth = photo.width / photo.height > target;
  const w = fitsWidth ? evenDown(photo.height * target) : evenDown(photo.width);
  const h = fitsWidth ? evenDown(photo.height) : evenDown(photo.width / target);
  const long = Math.max(w, h);
  const pw = even((w * WORK_LONG_SIDE) / long);
  const ph = even((h * WORK_LONG_SIDE) / long);
  return `crop=${w}:${h},scale=${pw}:${ph}:flags=lanczos,setsar=1`;
}

/** FFmpeg's arguments for one clip: the photo, then one sprite per subject. */
export function clipArgs(
  clip: ClipPlan,
  inputs: {
    readonly photo: string;
    readonly photoSize: { width: number; height: number };
    readonly sprites: readonly string[];
  },
  out: string,
): string[] {
  const frames = Math.round(clip.seconds * clip.fps);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputs.photo];
  for (const subject of clip.subjects)
    args.push(
      '-loop',
      '1',
      '-framerate',
      String(clip.fps),
      '-t',
      String(clip.seconds),
      '-i',
      inputs.sprites[subject.sprite]!,
    );
  const chain = [aspectCrop(clip, inputs.photoSize), ...cameraFilters(clip)];
  const graph = [`[0:v]${chain.join(',')}[c0]`];
  clip.subjects.forEach((subject, i) => {
    const { x, y, height } = subjectExpression(subject, clip);
    graph.push(`[${i + 1}:v]scale=-2:${height},format=rgba[s${i}]`);
    graph.push(`[c${i}][s${i}]overlay=x='${x}':y='${y}':eval=frame:shortest=1[c${i + 1}]`);
  });
  const last = `c${clip.subjects.length}`;
  const tail = [...(clip.noise > 0 ? [`noise=alls=${clip.noise}:allf=t`] : []), 'format=yuv420p'];
  graph.push(`[${last}]${tail.join(',')}[out]`);
  args.push(
    '-filter_complex',
    graph.join(';'),
    '-map',
    '[out]',
    '-frames:v',
    String(frames),
    '-r',
    String(clip.fps),
  );
  args.push(...videoEncodeFlags(softwareEncoderFor('h264')!, 4_000_000, clip.fps), '-an', out);
  return args;
}

/**
 * Where a sprite is cut from a subject photo: the most textured windows of a person's shape (the gray photo's
 * standard deviation in each window, on a small copy), `count` of them that don't overlap. Shares of the photo.
 */
export function textureWindows(
  gray: Uint8Array,
  width: number,
  height: number,
  count: number,
): { x: number; y: number }[] {
  const h = Math.floor(height * 0.45);
  const w = Math.floor(h * SPRITE_ASPECT);
  const step = Math.max(2, Math.floor(w / 6));
  const scored: { x: number; y: number; score: number }[] = [];
  for (let y = 0; y + h <= height; y += step)
    for (let x = 0; x + w <= width; x += step) {
      let sum = 0;
      let squares = 0;
      let n = 0;
      for (let yy = y; yy < y + h; yy += 2)
        for (let xx = x; xx < x + w; xx += 2) {
          const v = gray[yy * width + xx] ?? 0;
          sum += v;
          squares += v * v;
          n += 1;
        }
      scored.push({ x, y, score: squares / n - (sum / n) ** 2 });
    }
  scored.sort((a, b) => b.score - a.score);
  const chosen: { x: number; y: number }[] = [];
  for (const window of scored) {
    if (chosen.length >= count) break;
    if (chosen.some((c) => Math.abs(c.x - window.x) < w && Math.abs(c.y - window.y) < h)) continue;
    chosen.push(window);
  }
  return chosen.map((c) => ({ x: c.x / width, y: c.y / height }));
}

/** FFmpeg's arguments for one subject sprite: a crop of a subject photo at `at`, cut out with a person's outline. */
export function spriteArgs(
  photo: string,
  photoSize: { width: number; height: number },
  at: { x: number; y: number },
  out: string,
): string[] {
  const h = evenDown(photoSize.height * 0.45);
  const w = evenDown(h * SPRITE_ASPECT);
  const x = Math.min(photoSize.width - w, Math.max(0, Math.round(at.x * photoSize.width)));
  const y = Math.min(photoSize.height - h, Math.max(0, Math.round(at.y * photoSize.height)));
  const head = 'lt(pow((X/W-0.5)/0.16,2)+pow((Y/H-0.12)/0.105,2),1)';
  const body = 'gt(Y/H,0.21)*lt(abs(X/W-0.5),0.44-0.18*(Y/H-0.21))';
  return [
    ...['-hide_banner', '-loglevel', 'error', '-y', '-i', photo],
    '-vf',
    `crop=${w}:${h}:${x}:${y},scale=300:600,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*max(${head},${body})'`,
    ...['-frames:v', '1', out],
  ];
}
