// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runs the shipped `audio.identifyLanguage` job (the FFmpeg pass, Silero's voice scan, whisper tiny on the persistent
 * whisper-server, Anuvani-LID) on every clip of the set, cropped and whole, and keeps the evidence: Whisper's
 * distribution and every piece's full scores, which a recording identifier captures. The scorer then decides offline
 * under any prior and any constants; the evidence doesn't depend on either. Rows go to `<dir>/evidence.jsonl` as they
 * finish, and a rerun skips the rows already there.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createDirectJobRunner, err } from '@taalcut/core';
import {
  audioIdentifyLanguageJob,
  createAssetAudioStore,
  createAudioIndexJobs,
  createIndicLid,
  createSileroVad,
  createWhisperServerPool,
  freeLoopbackPort,
  posixServerSpawn,
  type IndicLid,
  type LanguageScore,
} from '@taalcut/audio';
import { appendJsonLines } from '../jsonl';
import { requireMediaBinaries } from '../media-bin';
import { clipSchema, LANGUAGE_SET, type LanguageClip } from './sets';
import { evidenceSchema, type EvidenceRow } from './evidence';

const run = promisify(execFile);
const devCache = join(homedir(), 'Library', 'Caches', 'Taalcut-dev', 'components');
const audioCache = fileURLToPath(new URL('../../../../packages/audio/.cache/', import.meta.url));

function firstThere(...paths: (string | undefined)[]): string {
  for (const path of paths) if (path && existsSync(path)) return path;
  throw new Error(`none of these exists: ${paths.filter(Boolean).join(', ')}`);
}

/** The models and binaries: the env, then the audio cache, then the developer component cache. */
export function languageTools() {
  return {
    server: firstThere(process.env.TAALCUT_WHISPER_SERVER, join(devCache, 'whisper-server')),
    tiny: firstThere(process.env.TAALCUT_WHISPER_TINY, join(audioCache, 'whisper/ggml-tiny.bin'), join(devCache, 'ggml-tiny.bin')),
    vad: firstThere(join(audioCache, 'silero-vad/silero_vad.onnx'), join(devCache, 'silero_vad.onnx')),
    lid: firstThere(process.env.TAALCUT_ANUVANI_LID_DIR, join(audioCache, 'anuvani-lid')),
  }; // prettier-ignore
}

/** An identifier that keeps every piece's full scores, in call order (the job's `pieces` are in the same order). */
function recording(inner: IndicLid): IndicLid & { take(): LanguageScore[][] } {
  let heard: LanguageScore[][] = [];
  return {
    async identify(samples, signal) {
      const scores = await inner.identify(samples, signal);
      if (scores.ok) heard.push(scores.value);
      return scores;
    },
    take() {
      const taken = heard;
      heard = [];
      return taken;
    },
  };
}

/** The clip's first `seconds` of sound (leading silence trimmed), or the clip itself for 0. */
async function cropped(ffmpeg: string, source: string, seconds: number, work: string): Promise<string> {
  const out = join(work, `crop-${seconds}.wav`);
  // Levelled to -23 LUFS: FLEURS has recordings peaking under -40 dBFS, which the audio pass rightly calls silent.
  // The eval measures the language, not the silence threshold (the as-recorded run is reported beside it).
  const level = 'loudnorm=I=-23:TP=-2:LRA=11';
  const trim =
    seconds === 0 ? level : `silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:${seconds},${level}`;
  await run(ffmpeg, ['-v', 'error', '-y', '-i', source, '-af', trim, '-ar', '16000', '-ac', '1', out]);
  return out;
}

export function readClips(dir: string): LanguageClip[] {
  return readFileSync(join(dir, 'clips.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => clipSchema.parse(JSON.parse(line)));
}

export function readEvidence(dir: string): EvidenceRow[] {
  const path = join(dir, 'evidence.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => evidenceSchema.parse(JSON.parse(line)));
}

export async function predictLanguageSet(options: {
  readonly dir: string;
  readonly log?: (line: string) => void;
}) {
  const log = options.log ?? (() => undefined);
  const tools = languageTools();
  const binaries = await requireMediaBinaries();
  const done = new Set(readEvidence(options.dir).map((row) => `${row.id}@${row.crop}`));
  const work = await mkdtemp(join(tmpdir(), 'taalcut-lang-eval-'));
  await mkdir(join(work, 'store'), { recursive: true });
  const store = createAssetAudioStore({ parent: join(work, 'store'), maxIdleBytes: 32 * 1024 ** 2 });
  const pool = createWhisperServerPool({
    launch: { spawn: posixServerSpawn, fetch, freePort: freeLoopbackPort, workDir: work },
    accelerator: 'metal',
  });
  const lid = recording(createIndicLid({ modelDir: tools.lid }));
  const backends = new Set<string>();
  const jobs = createAudioIndexJobs({
    store,
    media: { binaries },
    settings: { hasSpeechUploadConsent: () => false, localOnly: () => true, tier: () => 'recommended' },
    whisper: { binary: '', tiny: tools.tiny, small: '', medium: '' },
    beats: { onnx: { openSession: async () => err(new Error('unused') as never) }, modelDir: '' },
    decoder: pool.decoder(tools.server),
    vad: createSileroVad({ modelPath: tools.vad }),
    indicLid: lid,
    onFallback: (event) =>
      backends.add(
        `${event.operation}: wanted ${event.wanted.join(', ')}, fell back (${event.reason}) ${event.detail ?? ''}`,
      ),
  });
  const runner = createDirectJobRunner(jobs);
  const evidence = join(options.dir, 'evidence.jsonl');
  try {
    for (const clip of readClips(options.dir)) {
      for (const crop of LANGUAGE_SET.crops) {
        if (done.has(`${clip.id}@${crop}`)) continue;
        const path = await cropped(binaries.ffmpeg, join(options.dir, clip.file), crop, work);
        const contentHash = createHash('sha256')
          .update(await readFile(path))
          .digest('hex');
        lid.take();
        const started = performance.now();
        const out = await runner.run(audioIdentifyLanguageJob, { path, contentHash });
        const ms = Math.round(performance.now() - started);
        const heard = lid.take();
        if (!out.ok) {
          log(`${clip.id}@${crop}: ${out.error.code} ${out.error.detail ?? ''}`);
          appendJsonLines(evidence, [
            { id: clip.id, crop, failed: out.error.code, silent: false, whisper: [], ms },
          ]);
          continue;
        }
        const pieces = out.value.pieces?.map((piece, i) => ({
          startMs: piece.startMs,
          endMs: piece.endMs,
          scores: heard[i] ?? piece.top,
          ...(piece.later ? { later: true } : {}),
        }));
        const row: EvidenceRow = {
          id: clip.id,
          crop,
          silent: out.value.silent,
          speechMs: out.value.speech?.speechMs ?? 0,
          whisper: out.value.whisper ?? [],
          ...(pieces ? { pieces } : {}),
          ...(out.value.decision ? { job: out.value.decision } : {}),
          ms,
        };
        appendJsonLines(evidence, [row]);
        await rm(path, { force: true });
      }
      log(`${clip.id}`);
    }
  } finally {
    await pool.close();
    await store.close();
    await rm(work, { recursive: true, force: true });
  }
  for (const backend of backends) log(`fallback: ${backend}`);
}
