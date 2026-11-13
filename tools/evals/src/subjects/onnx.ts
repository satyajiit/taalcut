// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: the no-helper detector (vision's RTMO-s poses + YOLOX-Nano people on onnxruntime-node) on the labelled
 * frames. Each JPEG is decoded to RGB24 by FFmpeg (at its own size, or scaled to `--short-side`), detected, and
 * written to predictions.onnx.json in the set's folder: the poses' faces, people, and heads from vision's
 * `headsFrom`. Then scored against the labels: face and head recall overall and by visibility, every face miss,
 * faces off any labelled head, and how many labelled heads sit inside a person box.
 *
 *   tsx src/subjects/onnx.ts --set <dir> --models <subjects-onnx folder> [--labels <file or folder>]
 *     [--pose-score 0.3] [--keypoint-score 0.3] [--person-score 0.4] [--short-side 480] [--cpu] [--no-write]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as vision from '@taalcut/vision';
import { createOnnxSubjectDetector, createOrtRuntime, type SubjectTuning } from '@taalcut/vision';
import { ffmpegBin, type BuiltFrame } from './build';
import { coverage, scoreSubjects, type FractionBox, type LabelledFrame } from './score';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface OnnxFramePrediction {
  readonly faces: readonly FractionBox[];
  readonly people: readonly FractionBox[];
  readonly heads: readonly FractionBox[];
  /** The poses, for fitting head proportions: each person box, its score and COCO's 17 keypoints [x, y, score]. */
  readonly poses?: readonly { box: FractionBox; confidence: number; keypoints: number[][] }[];
}

export function readFrames(set: string): BuiltFrame[] {
  return (JSON.parse(readFileSync(join(set, 'frames.json'), 'utf8')) as { frames: BuiltFrame[] }).frames;
}

/** The frame's size with its short side at `short` (even sides, as FFmpeg's scaler wants), or its own. */
export function decodedSize(
  frame: { width: number; height: number },
  short?: number,
): { width: number; height: number } {
  if (short === undefined) return { width: frame.width, height: frame.height };
  const even = (value: number) => Math.max(2, 2 * Math.round(value / 2));
  return frame.width >= frame.height
    ? { width: even((frame.width * short) / frame.height), height: even(short) }
    : { width: even(short), height: even((frame.height * short) / frame.width) };
}

/** The JPEG as RGB24, row-major, at width × height. */
export function decodeRgb(file: string, width: number, height: number): Uint8Array {
  const run = spawnSync(
    ffmpegBin().ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `scale=${width}:${height}:flags=area`].concat([
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ]),
    { maxBuffer: width * height * 3 + 1024 },
  );
  if (run.status !== 0) throw new Error(`${file}: ffmpeg failed: ${run.stderr.toString()}`);
  const rgb = new Uint8Array(run.stdout.buffer, run.stdout.byteOffset, run.stdout.byteLength);
  if (rgb.length !== width * height * 3)
    throw new Error(`${file}: ${rgb.length} bytes for ${width}×${height}`);
  return rgb;
}

export interface OnnxRunOptions {
  readonly tuning?: Partial<SubjectTuning>;
  /** Decode each frame with this short side (what the track job would hand the detector); default its own size. */
  readonly shortSide?: number;
  /** The CPU only (ONNX Runtime's CPU provider, as on a machine with no usable GPU). */
  readonly cpu?: boolean;
}

export async function predictWithOnnx(
  set: string,
  modelDir: string,
  options: OnnxRunOptions = {},
): Promise<{
  predictions: Record<string, OnnxFramePrediction>;
  msPerFrame: number;
  backends: string;
}> {
  const runtime = createOrtRuntime(options.cpu ? { disableGpu: true } : {});
  const tuning = options.tuning ?? {};
  const detector = createOnnxSubjectDetector({ runtime, modelDir, tuning });
  const predictions: Record<string, OnnxFramePrediction> = {};
  let detecting = 0;
  try {
    for (const frame of readFrames(set)) {
      const size = decodedSize(frame, options.shortSide);
      const rgb = decodeRgb(join(set, frame.file), size.width, size.height);
      const started = performance.now();
      const detected = await detector.detect({ rgb, ...size });
      detecting += performance.now() - started;
      if (!detected.ok) throw new Error(`${frame.id}: ${JSON.stringify(detected.error)}`);
      predictions[frame.id] = {
        faces: detected.value.faces.map((face) => face.box),
        people: detected.value.people.map((person) => person.box),
        heads: vision.headsFrom(detected.value, size, tuning.keypointScore).heads.map((head) => head.box),
        poses: (detected.value.poses ?? []).map((pose) => ({
          box: pose.box,
          confidence: pose.confidence,
          keypoints: pose.keypoints.map((point) => [point.x, point.y, point.score]),
        })),
      };
    }
    const used = detector.backends();
    const count = Math.max(1, Object.keys(predictions).length);
    return {
      predictions,
      msPerFrame: detecting / count,
      backends: `poses ${used.poses ?? '?'}, people ${used.people ?? '?'}`,
    };
  } finally {
    await detector.release();
  }
}

type LabelFile = Record<string, LabelledFrame> | { readonly frames: Record<string, LabelledFrame> };
const framesOf = (file: LabelFile) =>
  ('frames' in file && typeof file.frames === 'object' ? file.frames : file) as Record<string, LabelledFrame>;

/**
 * The labels: labels.json next to this file (its `frames`) unless another is given: a file (labels.json's shape, or
 * frames keyed by id), or a folder whose labels-*.json batches are merged.
 */
export function readLabels(from?: string): Record<string, LabelledFrame> {
  const path = from ?? join(HERE, 'labels.json');
  if (!existsSync(path)) throw new Error(`no labels at ${path}`);
  if (!statSync(path).isDirectory()) return framesOf(JSON.parse(readFileSync(path, 'utf8')) as LabelFile);
  const files = readdirSync(path).filter((name) => /^labels-.*\.json$/.test(name));
  return Object.assign(
    {},
    ...files.map((name) => framesOf(JSON.parse(readFileSync(join(path, name), 'utf8')) as LabelFile)),
  ) as Record<string, LabelledFrame>;
}

const percent = (found: number, total: number) =>
  `${found}/${total} (${total > 0 ? ((100 * found) / total).toFixed(1) : '–'}%)`;

const centreIn = (box: FractionBox, inside: FractionBox) => {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return cx >= inside.x && cx <= inside.x + inside.width && cy >= inside.y && cy <= inside.y + inside.height;
};

export function report(
  labels: Readonly<Record<string, LabelledFrame>>,
  predictions: Readonly<Record<string, OnnxFramePrediction>>,
): string[] {
  const scored = scoreSubjects(labels, predictions);
  // byKind counts heads found; a face's recall by visibility is its labelled heads less its face misses.
  const faces = (face: 'frontal' | 'profile') => {
    const total = scored.byKind[`face:${face}`]?.total ?? 0;
    return percent(total - scored.faceMisses.filter((miss) => miss.face === face).length, total);
  };
  const lines = [
    `${scored.frames} labelled frames`,
    `face recall ${percent(scored.faces.found, scored.faces.total)}`,
    `  face:frontal ${faces('frontal')}`,
    `  face:profile ${faces('profile')}`,
  ];
  if (Object.values(predictions).some((p) => p.heads.length > 0))
    lines.push(
      `head recall ${percent(scored.heads.found, scored.heads.total)}, mean IoU ${scored.heads.meanIou.toFixed(3)}, ` +
        `${scored.falseHeadsPerFrame.toFixed(2)} false heads per frame`,
    );
  let stray = 0;
  let inPerson = 0;
  let heads = 0;
  let headless = 0;
  for (const [id, frame] of Object.entries(labels)) {
    const predicted = predictions[id];
    if (!predicted) continue;
    stray += predicted.faces.filter((face) => !frame.heads.some((head) => centreIn(face, head.box))).length;
    // A person box with no labelled head (ignored ones too) over half inside it: likely not a person.
    headless += predicted.people.filter(
      (person) => !frame.heads.some((head) => coverage(head.box, person) >= 0.5),
    ).length;
    for (const head of frame.heads) {
      if (head.ignore) continue;
      heads += 1;
      if (predicted.people.some((person) => coverage(head.box, person) >= 0.8)) inPerson += 1;
    }
  }
  lines.push(
    `faces on no labelled head: ${stray} (${(stray / Math.max(1, scored.frames)).toFixed(2)} per frame)`,
  );
  lines.push(
    `labelled heads inside a person box: ${percent(inPerson, heads)}; person boxes with no head: ${headless}`,
  );
  lines.push(`face misses (${scored.faceMisses.length}):`);
  for (const miss of scored.faceMisses)
    lines.push(
      `  ${miss.frame} head ${miss.head} ${miss.face}${miss.tags.length > 0 ? ` [${miss.tags.join(', ')}]` : ''}`,
    );
  return lines;
}

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

function number(name: string): number | undefined {
  const text = arg(name);
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} ${text} is not a positive number`);
  return value;
}

function tuningFromArgs(): Partial<SubjectTuning> {
  const poseScore = number('pose-score');
  const keypointScore = number('keypoint-score');
  const personScore = number('person-score');
  return {
    ...(poseScore !== undefined ? { poseScore } : {}),
    ...(keypointScore !== undefined ? { keypointScore } : {}),
    ...(personScore !== undefined ? { personScore } : {}),
  };
}

async function main(): Promise<void> {
  const set = arg('set');
  const models = arg('models');
  if (!set || !models) throw new Error('needs --set <dir> --models <subjects-onnx folder>');
  const shortSide = number('short-side');
  const run = await predictWithOnnx(set, models, {
    tuning: tuningFromArgs(),
    ...(shortSide !== undefined ? { shortSide } : {}),
    cpu: process.argv.includes('--cpu'),
  });
  if (!process.argv.includes('--no-write'))
    writeFileSync(join(set, 'predictions.onnx.json'), JSON.stringify(run.predictions, null, 1));
  console.log(
    `${Object.keys(run.predictions).length} frames, ${run.msPerFrame.toFixed(1)} ms per frame (${run.backends})`,
  );
  for (const line of report(readLabels(arg('labels')), run.predictions)) console.log(line);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((cause: unknown) => {
    console.error(cause);
    process.exitCode = 1;
  });
}
