// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where `vision.embed`'s time goes (IX2-G1), per asset, on the frames an indexing bench's stage asked for:
 *
 *   pnpm --filter @taalcut/vision bench:embed-frames --library <run>/run-1/index-library.sqlite \
 *     --out <jsonl> [--runs 3] [--coreml <embeddinggemma-2-coreml dir>] [--scratch <dir>] [--load <video>]
 *     [--options gap4,gap8,keyframes,session,helper --session-proto <binary> --helper <binary>] [--only <file,…>]
 *
 * For each asset, `--runs` times: today's read (a frame source over the original, a fresh cache, every
 * FFmpeg run timed), then the model on those frames. Once per asset: the seek windows and the frames each
 * decodes (keyframes from ffprobe's packet flags), and the parts of one run (spawn; open, decoder session
 * and one frame; a GOP decoded with one frame or all 30 written). `--load` keeps one other full hardware
 * decode of that file running meanwhile (two sessions at most: the brief's budget), as the shots pass
 * would. `--options` adds the IX2-G2 options on the same frames, in the same rounds: wider seek windows
 * (`gap<seconds>`), keyframe-only reads (`keyframes`, other frames: timed only) and one VideoToolbox session
 * per asset (`session`, a prototype binary; its frames compared byte for byte with today's). `helper` (IX2-G4,
 * `--helper <binary>`) reads them as the product does with the decode service on, through the mac helper's
 * `decode.frames`, compared byte for byte too, with the helper's and FFmpeg's peak memory. Run it under the
 * VT lock, on AC power.
 */
import { existsSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadavg, tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import * as media from '@taalcut/media';
import { embeddingFrameSize, parseImageTokenBudget, type ImageTokenBudget } from '../src/embed/space';
import { videoSourceOf } from '../src/media/frames';
import { benchAsset, type AssetBench, type BenchOption } from './embed-frames/asset';
import { currentRead } from './embed-frames/current';
import { benchEmbedder, modelMs } from './embed-frames/model';
import { readEmbedRequests, type EmbedRequest } from './embed-frames/requests';

const { values } = parseArgs({
  options: {
    library: { type: 'string' },
    out: { type: 'string' },
    runs: { type: 'string', default: '3' },
    tokens: { type: 'string', default: '140' },
    model: { type: 'string', default: fileURLToPath(new URL('../.cache/embeddinggemma-2', import.meta.url)) },
    coreml: { type: 'string' },
    scratch: { type: 'string' },
    load: { type: 'string' },
    only: { type: 'string' },
    options: { type: 'string', default: '' },
    'session-proto': { type: 'string' },
    helper: { type: 'string' },
  },
});

/** A full hardware decode of `path`, again and again until `stop()`; the decode under way always finishes. */
function backgroundDecode(ctx: media.MediaContext, path: string) {
  let stopping = false;
  let decodes = 0;
  const loop = (async () => {
    while (!stopping) {
      const run = await media.runProcess(ctx.binaries.ffmpeg, [
        ...['-v', 'error', '-hwaccel', 'videotoolbox', '-hwaccel_output_format', 'videotoolbox_vld'],
        ...['-i', path, '-f', 'null', '-'],
      ]);
      if (!run.ok) throw new Error(`background decode: ${run.error.code}`);
      decodes += 1;
    }
  })();
  return {
    async stop() {
      stopping = true;
      await loop;
      return decodes;
    },
  };
}

/** One asset: measured, appended to `--out` as a row, and a line on stdout. */
async function benchOne(bench: AssetBench, request: EmbedRequest, tokens: ImageTokenBudget): Promise<void> {
  const { width, height } = request.plan.source;
  // The stage's size: the embedder's for the frame source's picture (display size, upright).
  const video = videoSourceOf(request.path, request.plan);
  const size = embeddingFrameSize(video.width, video.height, tokens);
  const measured = await benchAsset(bench, request, size);
  const row = {
    file: request.file,
    codec: request.plan.source.codec,
    size: `${width}x${height}`,
    fps: request.plan.frameRate.output.num / request.plan.frameRate.output.den,
    embedSize: `${size.width}x${size.height}`,
    bench: { ffmpeg: request.benchFfmpeg, ms: request.benchMs },
    ...measured,
    load: loadavg().map((l) => Math.round(l * 10) / 10),
    background: values.load ? 'one full decode' : 'none',
  };
  await appendFile(values.out ?? '', `${JSON.stringify(row)}\n`);
  const shown = Object.entries(measured.options).map(([name, o]) => `${name} ${o.ms.median}`);
  const { helper, session } = measured;
  if (helper)
    shown.push(
      `helper ${helper.ms.median} (${helper.identical}/${helper.compared} identical, ${helper.ffmpeg} FFmpeg, ${helper.hwaccel} on the hardware)`,
    );
  if (session)
    shown.push(`session ${session.wallMs.median} (${session.identical}/${session.compared} identical)`);
  process.stdout.write(
    `${request.file.padEnd(32)} frames ${String(measured.frames).padStart(3)}  windows ${String(row.windows.length).padStart(2)}  read ${row.readMs.median} ms [${row.readMs.min}–${row.readMs.max}]  model ${row.modelMs.median} ms  one-frame run ${row.parts.oneFrameMs.median} ms  ${shown.join('  ')}  load ${row.load[0]}\n`,
  );
}

async function main(): Promise<number> {
  if (!values.library || !values.out) {
    console.error(
      'usage: bench:embed-frames --library <index-library.sqlite> --out <jsonl> [--coreml <dir>]',
    );
    return 2;
  }
  const tokens = parseImageTokenBudget(values.tokens);
  if (!tokens) throw new Error('--tokens is 70, 140 or 280');
  const binaries = await media.createBinaryResolver({ development: true }).resolve();
  if (!binaries.ok) throw new Error(`no FFmpeg: ${binaries.error.code}`);
  const ctx: media.MediaContext = { binaries: binaries.value, toneMaps: new media.ToneMapSelection() };
  const root = values.scratch ?? tmpdir();
  await mkdir(root, { recursive: true });
  // The helper resolves symlinks before it checks its allowed root.
  const scratch = await realpath(await mkdtemp(join(root, 'embed-frames-')));
  const runs = Math.max(1, Number(values.runs));
  const only = values.only?.split(',');
  const requests = readEmbedRequests(values.library).filter((r) => !only || only.includes(r.file));
  if (values.coreml && !existsSync(values.coreml)) throw new Error(`no Core ML folder at ${values.coreml}`);
  const embedder = await benchEmbedder({
    modelDir: values.model,
    tempDir: scratch,
    imageTokens: tokens,
    ...(values.coreml ? { coremlDir: values.coreml } : {}),
  });
  const options = values.options
    .split(',')
    .map((name) => name.trim())
    .filter((name): name is BenchOption => /^(session|helper|keyframes|pass|gap\d+)$/.test(name));
  const bench: AssetBench = {
    ctx,
    embedder,
    runs,
    scratch,
    options,
    ...(values['session-proto'] ? { sessionProto: values['session-proto'] } : {}),
    ...(values.helper ? { helper: values.helper } : {}),
  };
  const background = values.load ? backgroundDecode(ctx, values.load) : undefined;
  try {
    // The first call loads the model (and compiles it once per Mac): not an asset's cost.
    const first = requests[0];
    if (first) {
      const video = videoSourceOf(first.path, first.plan);
      const size = embeddingFrameSize(video.width, video.height, tokens);
      const warm = await currentRead(ctx, { ...first, frames: first.frames.slice(0, 1) }, size, scratch);
      await modelMs(embedder, warm.frames);
    }
    for (const request of requests) await benchOne(bench, request, tokens);
  } finally {
    const decodes = background ? await background.stop() : 0;
    if (background) process.stdout.write(`background decodes: ${decodes}\n`);
    await embedder.close();
    await rm(scratch, { recursive: true, force: true });
  }
  return 0;
}

process.exitCode = await main();
