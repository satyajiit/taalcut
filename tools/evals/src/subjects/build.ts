// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: rebuilds the subjects fixture set (set.json) in a folder outside the repo: downloads each CC0, CC-BY or
 * public-domain source once (Commons' transcodes, Blender's Tears of Steel), then extracts each frame as a JPEG,
 * cropped to 9:16 where the set asks. The frames are never committed; labels.json is (our own head boxes).
 *
 *   pnpm --filter @taalcut/evals fixtures:subjects -- --out <dir>
 */
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { bundledFfmpeg } from '../ffmpeg-bin';

export interface SubjectSource {
  readonly id: string;
  readonly title: string;
  readonly page: string;
  readonly download: string;
  readonly licence: string;
  readonly author: string;
}

export interface SubjectFrameSpec {
  readonly id: string;
  readonly source: string;
  /** Seconds into the source. */
  readonly at: number;
  /** A crop of the given aspect (width / height) at full height, its left edge at `x` of the free width. */
  readonly crop?: { readonly x: number; readonly aspect: number };
}

export interface SubjectSet {
  readonly version: 1;
  readonly sources: readonly SubjectSource[];
  readonly frames: readonly SubjectFrameSpec[];
}

export interface BuiltFrame {
  readonly id: string;
  readonly file: string;
  readonly width: number;
  readonly height: number;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT = 'TaalcutEvalFixtures/0.1 (https://github.com/taalcut; subjects eval set)';

export function loadSubjectSet(): SubjectSet {
  return JSON.parse(readFileSync(join(HERE, 'set.json'), 'utf8')) as SubjectSet;
}

export const ffmpegBin = (): { ffmpeg: string; ffprobe: string } =>
  bundledFfmpeg() ?? { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };

async function download(url: string, out: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { headers: { 'user-agent': AGENT } });
    if (response.ok && response.body) {
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(`${out}.part`));
      renameSync(`${out}.part`, out);
      return;
    }
    // Commons answers 429 to a burst: wait and try again, politely.
    if (attempt >= 5) throw new Error(`${url}: HTTP ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 5_000 * (attempt + 1)));
  }
}

function probeSize(ffprobe: string, file: string): { width: number; height: number } {
  const probe = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [width, height] = probe.stdout.trim().split(',').map(Number);
  if (!width || !height) throw new Error(`${file}: no video size`);
  return { width, height };
}

export async function buildSubjectSet(out: string, set: SubjectSet = loadSubjectSet()): Promise<BuiltFrame[]> {
  const { ffmpeg, ffprobe } = ffmpegBin();
  mkdirSync(join(out, 'sources'), { recursive: true });
  mkdirSync(join(out, 'frames'), { recursive: true });
  const paths = new Map<string, string>();
  for (const source of set.sources) {
    const extension = source.download.split('?')[0]!.split('.').pop() ?? 'bin';
    const path = join(out, 'sources', `${source.id}.${extension}`);
    if (!existsSync(path)) await download(source.download, path);
    paths.set(source.id, path);
  }
  const built: BuiltFrame[] = [];
  for (const frame of set.frames) {
    const file = join(out, 'frames', `${frame.id}.jpg`);
    const source = paths.get(frame.source);
    if (!source) throw new Error(`${frame.id}: no source ${frame.source}`);
    if (!existsSync(file)) {
      const filters = frame.crop
        ? [`crop=trunc(ih*${frame.crop.aspect}/2)*2:ih:(iw-trunc(ih*${frame.crop.aspect}/2)*2)*${frame.crop.x}:0`]
        : [];
      const args = ['-hide_banner', '-loglevel', 'error', '-ss', String(frame.at), '-i', source];
      if (filters.length > 0) args.push('-vf', filters.join(','));
      args.push('-frames:v', '1', '-q:v', '2', '-y', file);
      const run = spawnSync(ffmpeg, args, { encoding: 'utf8' });
      if (run.status !== 0) throw new Error(`${frame.id}: ffmpeg failed: ${run.stderr}`);
    }
    built.push({ id: frame.id, file: `frames/${frame.id}.jpg`, ...probeSize(ffprobe, file) });
  }
  writeFileSync(join(out, 'frames.json'), JSON.stringify({ version: 1, frames: built }, null, 1));
  writeFileSync(
    join(out, 'CREDITS.md'),
    ['# Subjects eval set: sources', '', ...set.sources.map((s) => `- ${s.title}: ${s.licence}, ${s.author}. ${s.page}`), ''].join('\n'),
  );
  return built;
}
