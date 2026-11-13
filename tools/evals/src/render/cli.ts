// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { exportRenderSystem } from '../adapters/render';
import { type RenderQaOutcome } from '../adapters/types';
import { requireMediaBinaries } from '../media-bin';
import { cliArgs, isDirectRun } from '../entry';
import { bundledFfmpeg } from '../ffmpeg-bin';
import { jsonPathFor } from '../report';
import { approveGolden } from './approve';
import { clickOnsets, readWavPcm } from './audio';
import { decodeFrames } from './encode';
import { writeRenderFixtures } from './fixtures';
import { dHash, type HashSample } from './hash';
import { loadApprovedHashes, loadRenderGoldens } from './load';
import { predictRenders, readQaNote } from './predict';
import { evalShell } from './real-engine';
import { wavPathFor } from './paths';
import { renderJson, renderMarkdown } from './report';
import { buildRenderReport, type DecodedRender } from './run';
import { type RenderGolden } from './schema';
import { readStrip } from './strip';

const USAGE = `Usage:
  taalcut-evals render check --golden <timeline.json|dir> (--video <file> | --renders <dir>) --out <report.md>
  taalcut-evals render predict --golden <timeline.json|dir> --out <rendersDir> [--work <dir>]
  taalcut-evals render fixtures --out <dir>
  taalcut-evals render approve --golden <timeline.json> --video <file> --out <dir>

predict exports each golden through @taalcut/render's engine (needs FFmpeg and chrome-headless-shell 152)
and writes what check --renders reads.`;

function requireFfmpeg(): string {
  const bins = bundledFfmpeg();
  if (bins === undefined) throw new Error('ffmpeg is not available');
  return bins.ffmpeg;
}

function hashesFor(
  golden: RenderGolden,
  raw: readonly Buffer[],
  approved: HashSample[] | undefined,
): HashSample[] | undefined {
  if (approved === undefined) return undefined;
  const samples: HashSample[] = [];
  const wanted = new Set<number>(approved.map((sample) => sample.outputFrame));
  for (const outputFrame of wanted) {
    const rgb = raw[outputFrame];
    if (rgb === undefined) continue;
    samples.push({ outputFrame, dHash: dHash(rgb, golden.width, golden.height, golden.cellSize) });
  }
  return samples;
}

async function inspect(
  golden: RenderGolden,
  videoPath: string,
  ffmpeg: string,
  timelinePath: string,
): Promise<DecodedRender> {
  if (!existsSync(videoPath)) throw new Error(`No render for ${golden.id}. Expected ${videoPath}`);
  const raw = await decodeFrames(ffmpeg, videoPath, golden.width, golden.height);
  const frames = raw.map((rgb) => readStrip(rgb, golden.width, golden.height, golden.cellSize));
  const wavPath = wavPathFor(videoPath);
  let onsets: number[] = [];
  if (existsSync(wavPath)) {
    const wav = readWavPcm(readFileSync(wavPath));
    onsets = clickOnsets(wav.pcm, wav.sampleRate);
  }
  const approvedHashes = loadApprovedHashes(timelinePath);
  const note = readQaNote(dirname(videoPath), golden.id);
  return {
    golden,
    frames,
    onsets,
    actualHashes: hashesFor(golden, raw, approvedHashes),
    approvedHashes,
    ...(note ? { qaPassed: note.qaPassed } : {}),
  };
}

async function predictCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { golden: { type: 'string' }, out: { type: 'string' }, work: { type: 'string' } },
    strict: true,
  });
  if (values.golden === undefined || values.out === undefined) {
    throw new Error(`${USAGE}\n--golden and --out are required`);
  }
  const shell = evalShell();
  if (!shell.ok) throw new Error(`No chrome-headless-shell 152: ${shell.error.detail ?? shell.error.code}`);
  const binaries = await requireMediaBinaries();
  const out = resolve(values.out);
  const work =
    values.work === undefined ? mkdtempSync(join(tmpdir(), 'taalcut-evals-render-')) : resolve(values.work);
  const qa = new Map<string, RenderQaOutcome>();
  const system = exportRenderSystem({
    media: { binaries },
    shell: shell.value,
    workDir: work,
    onQa: (id, outcome) => qa.set(id, outcome),
  });
  try {
    const notes = await predictRenders(system, loadRenderGoldens(resolve(values.golden)), out, qa);
    const seconds = notes.reduce((sum, note) => sum + note.seconds, 0);
    console.log(`Rendered ${notes.length} golden(s) into ${out} in ${seconds.toFixed(1)} s`);
  } finally {
    if (values.work === undefined) rmSync(work, { recursive: true, force: true });
  }
  return 0;
}

async function checkCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      golden: { type: 'string' },
      video: { type: 'string' },
      renders: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  if (values.golden === undefined || values.out === undefined) {
    throw new Error(`${USAGE}\n--golden and --out are required`);
  }
  if (values.video === undefined && values.renders === undefined) {
    throw new Error(`${USAGE}\n--video or --renders is required`);
  }
  if (values.video !== undefined && values.renders !== undefined) {
    throw new Error('Pass either --video or --renders, not both');
  }
  const loaded = loadRenderGoldens(resolve(values.golden));
  if (values.video !== undefined && loaded.length !== 1) {
    throw new Error('--video checks one golden; use --renders for a directory');
  }
  const ffmpeg = requireFfmpeg();
  const renders = values.renders === undefined ? undefined : resolve(values.renders);
  const video = values.video === undefined ? undefined : resolve(values.video);
  const decoded: DecodedRender[] = [];
  for (const item of loaded) {
    const videoPath = video ?? join(renders ?? '', `${item.golden.id}.mkv`);
    decoded.push(await inspect(item.golden, videoPath, ffmpeg, item.timelinePath));
  }
  const report = buildRenderReport(decoded);
  const outPath = resolve(values.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderMarkdown(report));
  writeFileSync(jsonPathFor(outPath), renderJson(report));
  const passing = report.goldens.filter(
    (golden) => golden.cutTiming && golden.beatGrid && golden.audioDrift,
  ).length;
  console.log(
    `Wrote ${outPath} (${passing}/${report.goldens.length} goldens pass cut timing, beat grid, and drift)`,
  );
  return 0;
}

function fixturesCommand(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: { out: { type: 'string' } },
    strict: true,
  });
  if (values.out === undefined) throw new Error(`${USAGE}\n--out is required`);
  const ids = writeRenderFixtures(resolve(values.out));
  console.log(`Wrote ${ids.length} render timeline(s) to ${resolve(values.out)}`);
  return 0;
}

async function approveCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      golden: { type: 'string' },
      video: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  if (values.golden === undefined || values.video === undefined || values.out === undefined) {
    throw new Error(`${USAGE}\n--golden, --video, and --out are required`);
  }
  const loaded = loadRenderGoldens(resolve(values.golden));
  const only = loaded[0];
  if (loaded.length !== 1 || only === undefined) throw new Error('--golden must be one timeline.json');
  const hashPath = await approveGolden(resolve(values.video), only.golden, resolve(values.out));
  console.log(`Wrote ${hashPath}`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  try {
    const args = cliArgs(argv);
    const command = args[0];
    const rest = cliArgs(args.slice(1));
    if (command === 'check') return await checkCommand(rest);
    if (command === 'predict') return await predictCommand(rest);
    if (command === 'fixtures') return fixturesCommand(rest);
    if (command === 'approve') return await approveCommand(rest);
    throw new Error(USAGE);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
