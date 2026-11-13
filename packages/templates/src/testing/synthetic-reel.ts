// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Synthetic reference reels for tests and the synthetic eval (P2-T4): solid
 * coloured shots with film-grain noise, hard cuts at known frames (a 2-frame
 * shot among them), a dissolve, a fade through black, a one-frame flash that
 * is not a cut, boxes drawn over known frames (our LGPL FFmpeg has no
 * drawtext, so text is stood in for by drawbox), and a click track at a known
 * BPM. `syntheticReelArgs` is the FFmpeg command (lavfi only); `labels` is
 * the ground truth from the construction. Synthetic numbers are never a gate
 * result: the real 85% gate needs the human golden set (H3).
 */
export interface SyntheticShot {
  readonly colour: string;
  /** Frames this shot owns on the timeline (a dissolve's overlap is split evenly either side of the cut). */
  readonly frames: number;
  /** How this shot begins. Default a hard cut. */
  readonly into?: { readonly kind: 'dissolve' | 'fadeBlack'; readonly frames: number };
}

export interface SyntheticBox {
  readonly start: number;
  readonly end: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SyntheticReelSpec {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Frames per second as num/den (30/1, 30000/1001). */
  readonly rate: { readonly num: number; readonly den: number };
  readonly shots: readonly SyntheticShot[];
  /** Frames with a full-frame white flash (one frame each): not cuts. */
  readonly flashes?: readonly number[];
  readonly boxes?: readonly SyntheticBox[];
  readonly audio:
    { readonly kind: 'click'; readonly bpm: number } | { readonly kind: 'tone' } | { readonly kind: 'none' };
}

export interface SyntheticLabels {
  readonly durationFrames: number;
  /** First frame of each new shot; a dissolve's cut is its middle. */
  readonly cuts: readonly number[];
  readonly transitions: readonly { readonly atFrame: number; readonly kind: 'cut' | 'dissolve' | 'fade' }[];
  /** Click times as frames (rounded). */
  readonly beats: readonly number[];
  readonly overlays: readonly SyntheticBox[];
  readonly audio: 'music' | 'ambience' | 'silence';
}

const seconds = (frames: number, rate: SyntheticReelSpec['rate']) => (frames * rate.den) / rate.num;
const fmt = (value: number) => value.toFixed(6);

export function syntheticLabels(spec: SyntheticReelSpec): SyntheticLabels {
  const cuts: number[] = [];
  const transitions: { atFrame: number; kind: 'cut' | 'dissolve' | 'fade' }[] = [];
  let at = 0;
  spec.shots.forEach((shot, index) => {
    if (index > 0) {
      cuts.push(at);
      transitions.push({
        atFrame: at,
        kind: shot.into?.kind === 'dissolve' ? 'dissolve' : shot.into ? 'fade' : 'cut',
      });
    }
    at += shot.frames;
  });
  const beats: number[] = [];
  if (spec.audio.kind === 'click') {
    const step = (60 / spec.audio.bpm) * (spec.rate.num / spec.rate.den);
    for (let k = 0; Math.round(k * step) < at; k++) beats.push(Math.round(k * step));
  }
  return {
    durationFrames: at,
    cuts,
    transitions,
    beats,
    overlays: spec.boxes ?? [],
    audio: spec.audio.kind === 'click' ? 'music' : spec.audio.kind === 'tone' ? 'ambience' : 'silence',
  };
}

/**
 * The H.264 encoder a reel is written with when the caller names none: VideoToolbox on a Mac, as it always was;
 * OpenH264 elsewhere (every LGPL build has it). Callers that hold a media context pass media's working encoder
 * (`selectWorkingEncoder`: h264_nvenc on an NVIDIA machine).
 */
export const DEFAULT_REEL_ENCODER = process.platform === 'darwin' ? 'h264_videotoolbox' : 'libopenh264';

/** The FFmpeg argv (no shell) that writes the reel to `out` (mp4, H.264 on `encoder`, AAC). */
export function syntheticReelArgs(
  spec: SyntheticReelSpec,
  out: string,
  options: { readonly encoder?: string } = {},
): string[] {
  const { rate } = spec;
  const r = `${rate.num}/${rate.den}`;
  // xfade needs both inputs on one timebase; concat's output otherwise drifts to microseconds.
  const tb = `${rate.den}/${rate.num}`;
  const inputs: string[] = [];
  const graph: string[] = [];
  spec.shots.forEach((shot, index) => {
    const next = spec.shots[index + 1];
    const dissolveIn = shot.into?.kind === 'dissolve' ? Math.ceil(shot.into.frames / 2) : 0;
    const dissolveOut = next?.into?.kind === 'dissolve' ? Math.floor(next.into.frames / 2) : 0;
    const frames = shot.frames + dissolveIn + dissolveOut;
    inputs.push(
      '-f',
      'lavfi',
      '-i',
      `color=c=${shot.colour}:s=${spec.width}x${spec.height}:r=${r}:d=${fmt(seconds(frames + 1, rate))}`,
    );
    const fades: string[] = [];
    if (shot.into?.kind === 'fadeBlack') fades.push(`fade=t=in:s=0:n=${Math.floor(shot.into.frames / 2)}`);
    if (next?.into?.kind === 'fadeBlack') {
      const n = Math.ceil(next.into.frames / 2);
      fades.push(`fade=t=out:s=${frames - n}:n=${n}`);
    }
    graph.push(
      `[${index}:v]trim=end_frame=${frames},setpts=PTS-STARTPTS,format=yuv420p,noise=alls=8:allf=t${fades.map((f) => `,${f}`).join('')},settb=${tb}[s${index}]`,
    );
  });
  // Join: a dissolve overlaps the two shots by its length; everything else is a concat.
  let chain = 's0';
  let length =
    spec.shots[0]!.frames +
    (spec.shots[1]?.into?.kind === 'dissolve' ? Math.floor(spec.shots[1].into.frames / 2) : 0);
  spec.shots.slice(1).forEach((shot, i) => {
    const index = i + 1;
    const label = `c${index}`;
    const next = spec.shots[index + 1];
    const tail = next?.into?.kind === 'dissolve' ? Math.floor(next.into.frames / 2) : 0;
    if (shot.into?.kind === 'dissolve') {
      const d = shot.into.frames;
      const own = shot.frames + Math.ceil(d / 2) + tail;
      graph.push(
        `[${chain}][s${index}]xfade=transition=fade:duration=${fmt(seconds(d, rate))}:offset=${fmt(seconds(length - d, rate))},settb=${tb}[${label}]`,
      );
      length += own - d;
    } else {
      graph.push(`[${chain}][s${index}]concat=n=2:v=1:a=0,settb=${tb}[${label}]`);
      length += shot.frames + tail;
    }
    chain = label;
  });
  const draw = [
    ...(spec.boxes ?? []).map(
      (box) =>
        `drawbox=x=iw*${box.x}:y=ih*${box.y}:w=iw*${box.width}:h=ih*${box.height}:color=white@1:t=fill:enable='between(n,${box.start},${box.end - 1})'`,
    ),
    ...(spec.flashes ?? []).map(
      (frame) => `drawbox=x=0:y=0:w=iw:h=ih:color=white@1:t=fill:enable='eq(n,${frame})'`,
    ),
  ];
  graph.push(
    `[${chain}]${draw.length > 0 ? draw.join(',') : 'null'},trim=end_frame=${length},setpts=PTS-STARTPTS[vout]`,
  );

  const total = seconds(length, rate);
  const audio: string[] = [];
  const map = ['-map', '[vout]'];
  if (spec.audio.kind !== 'none') {
    const period = 60 / (spec.audio.kind === 'click' ? spec.audio.bpm : 120);
    const expr =
      spec.audio.kind === 'click'
        ? `if(lt(mod(t\\,${fmt(period)})\\,0.01)\\,0.8*sin(2*PI*1000*t)\\,0)`
        : '0.2*sin(2*PI*220*t)';
    audio.push('-f', 'lavfi', '-i', `aevalsrc=exprs=${expr}:s=48000:d=${fmt(total)}`);
    map.push('-map', `${spec.shots.length}:a`, '-c:a', 'aac', '-b:a', '128k');
  }
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...inputs,
    ...audio,
    '-filter_complex',
    graph.join(';'),
    ...map,
    '-c:v',
    options.encoder ?? DEFAULT_REEL_ENCODER,
    '-b:v',
    '3M',
    '-pix_fmt',
    'yuv420p',
    '-r',
    r,
    '-fps_mode',
    'cfr',
    '-shortest',
    out,
  ];
}

// Saturated, alternating light and dark: neighbours differ in luma and hue, as most real cuts do.
const palette = [
  '#d62828',
  '#1d4ed8',
  '#f4d35e',
  '#0b6e4f',
  '#ff70a6',
  '#2b2d42',
  '#06d6a0',
  '#7b2cbf',
  '#ffa62b',
  '#118ab2',
];
const colour = (index: number) => palette[index % palette.length]!.replace('#', '0x');

function shots(
  lengths: readonly number[],
  into: Record<number, SyntheticShot['into']> = {},
): SyntheticShot[] {
  return lengths.map((frames, index) => ({
    colour: colour(index),
    frames,
    ...(into[index] ? { into: into[index] } : {}),
  }));
}

/** The reels the integration test and the synthetic eval run, small so a loaded machine copes. */
export const SYNTHETIC_REELS: readonly SyntheticReelSpec[] = [
  {
    id: 'synthetic-hard-cuts',
    width: 270,
    height: 480,
    rate: { num: 30, den: 1 },
    shots: shots([24, 18, 2, 30, 26, 20, 16, 24]),
    flashes: [50],
    boxes: [
      { start: 6, end: 40, x: 0.1, y: 0.12, width: 0.8, height: 0.08 },
      { start: 100, end: 150, x: 0.2, y: 0.75, width: 0.6, height: 0.05 },
    ],
    audio: { kind: 'click', bpm: 120 },
  },
  {
    id: 'synthetic-transitions',
    width: 270,
    height: 480,
    rate: { num: 30, den: 1 },
    shots: shots([30, 36, 30, 28, 30], {
      2: { kind: 'dissolve', frames: 12 },
      4: { kind: 'fadeBlack', frames: 16 },
    }),
    audio: { kind: 'click', bpm: 100 },
  },
  {
    id: 'synthetic-silent-ntsc',
    width: 270,
    height: 480,
    rate: { num: 30000, den: 1001 },
    shots: shots([20, 15, 25, 12, 30, 18]),
    audio: { kind: 'none' },
  },
  {
    id: 'synthetic-original-sound',
    width: 480,
    height: 270,
    rate: { num: 25, den: 1 },
    shots: shots([25, 40, 10, 35, 30]),
    boxes: [{ start: 30, end: 90, x: 0.05, y: 0.05, width: 0.4, height: 0.1 }],
    audio: { kind: 'tone' },
  },
];
