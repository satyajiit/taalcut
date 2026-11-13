// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `eval:find` (LIB1-FIND): does search find "the dance shots"?
 * - `fetch` builds the library folder from `search-find/clips.json` (and a local owner set's clips with `--owner`).
 * - `index` indexes it as the app does (shots, analysis, on-screen text, frame and text vectors) into `library.db`.
 * - `record` describes every shot with a live vision model and writes the answers to a recording.
 * - `run` replays a recording's descriptions onto a copy and scores every query, per fusion candidate.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cliArgs, isDirectRun } from '../../entry';
import { writeJson, writeText } from '../../files';
import { requireMediaBinaries } from '../../media-bin';
import { librarySearchSystem } from '../../adapters/search';
import { FIND_CANDIDATES } from './candidates';
import { fetchFindLibrary } from './fetch';
import { recordingModels } from './models';
import { findMarkdown } from './report';
import { runFindEval } from './run';
import {
  isOwnerClip,
  loadClips,
  loadOwnerSet,
  loadQueries,
  loadRecording,
  localRecordingPath,
  mergeQueries,
  OWNER_SET,
} from './schema';
import { openFindSession } from './session';
import { describeLibrary, openFindLibrary } from './stored';

const USAGE = `Usage:
  eval:find fetch --library <dir> [--owner <folder with the clips search-find/owner.local.json names>]
  eval:find index --library <dir> --work-dir <dir> [--coreml-dir <dir>]
  eval:find record --library <dir> --db <library.db> --out <recording.json> [--model <ollama model>] [--ollama <url>]
  eval:find run --library <dir> --db <library.db> --out <report.md> [--descriptions <recording.json>|none]
                [--candidate <id>]...

index loads TransNetV2, EmbeddingGemma 2 and Apple Vision on the GPU and Neural Engine: run it in a heavy slot.
record asks a local Ollama server (default ${'http://127.0.0.1:11434'}, model qwen3.5:4b-q4_K_M).
Candidates: ${FIND_CANDIDATES.map((c) => c.id).join(', ')} (default all).`;

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, '../../../search-find');
const log = (line: string) => console.warn(`[find] ${line}`);

function need(values: Record<string, unknown>, ...names: string[]): void {
  const missing = names.filter((name) => values[name] === undefined);
  if (missing.length > 0) throw new Error(`${USAGE}\n--${missing.join(', --')} required`);
}

async function fetchCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { library: { type: 'string' }, owner: { type: 'string' } },
  });
  need(values, 'library');
  const binaries = await requireMediaBinaries();
  const ownerSet = values.owner ? loadOwnerSet(DATA) : null;
  if (values.owner && !ownerSet) throw new Error(`--owner needs search-find/${OWNER_SET}`);
  await fetchFindLibrary({
    clips: loadClips(join(DATA, 'clips.json')),
    out: resolve(values.library!),
    ffmpeg: binaries.ffmpeg,
    ffprobe: binaries.ffprobe,
    ...(values.owner && ownerSet ? { owner: { dir: resolve(values.owner), clips: ownerSet.clips } } : {}),
    log,
  });
  return 0;
}

async function indexCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      library: { type: 'string' },
      'work-dir': { type: 'string' },
      'coreml-dir': { type: 'string' },
    },
  });
  need(values, 'library', 'work-dir');
  const system = librarySearchSystem({
    libraryDir: resolve(values.library!),
    workDir: resolve(values['work-dir']!),
    ocr: true,
    ...(values['coreml-dir'] ? { coremlDir: resolve(values['coreml-dir']) } : {}),
    log,
  });
  try {
    await system.index();
  } finally {
    await system.close();
  }
  log(`wrote ${join(resolve(values['work-dir']!), 'library.db')}`);
  return 0;
}

async function recordCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      library: { type: 'string' },
      db: { type: 'string' },
      out: { type: 'string' },
      model: { type: 'string', default: 'qwen3.5:4b-q4_K_M' },
      ollama: { type: 'string', default: 'http://127.0.0.1:11434' },
      'coreml-dir': { type: 'string' },
    },
  });
  need(values, 'library', 'db', 'out');
  const out = resolve(values.out!);
  // Scratch for the library copy and frames, outside the repo, where recordings are committed.
  const workDir = await mkdtemp(join(tmpdir(), 'taalcut-find-record-'));
  const session = await openFindSession({
    libraryDir: values.library!,
    workDir,
    ...(values['coreml-dir'] ? { coremlDir: resolve(values['coreml-dir']) } : {}),
    log,
  });
  try {
    const models = recordingModels({ baseUrl: values.ollama!, model: values.model! });
    const library = openFindLibrary(resolve(values.db!), session.manifest, workDir, 'recording');
    try {
      // A clip the model fails on is recorded too: its answers replay to the same failure, as the app would.
      const failures = await describeLibrary(library, { ...session, models, tier: 'recommended', log });
      for (const failure of failures) log(`describing failed: ${failure}`);
    } finally {
      library.close();
    }
    const recording = models.recording(new Date());
    // The owner set's answers (its clips' text, frames and what the model said of them) stay in the local part.
    const own = recording.answers.filter((answer) => isOwnerClip(answer.clip));
    writeJson(out, {
      ...recording,
      answers: recording.answers.filter((answer) => !isOwnerClip(answer.clip)),
    });
    if (own.length > 0) writeJson(localRecordingPath(out), { ...recording, answers: own });
    log(
      `${recording.answers.length} answers (${own.length} local) under prompt ${recording.prompt} in ${out}`,
    );
  } finally {
    await session.close();
    await rm(workDir, { recursive: true, force: true });
  }
  return 0;
}

async function runCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      library: { type: 'string' },
      db: { type: 'string' },
      out: { type: 'string' },
      descriptions: { type: 'string', default: 'none' },
      candidate: { type: 'string', multiple: true },
      queries: { type: 'string' },
      'coreml-dir': { type: 'string' },
    },
  });
  need(values, 'library', 'db', 'out');
  const candidates = (values.candidate ?? FIND_CANDIDATES.map((c) => c.id)).map((id) => {
    const found = FIND_CANDIDATES.find((c) => c.id === id);
    if (!found) throw new Error(`unknown candidate ${id}`);
    return found;
  });
  const out = resolve(values.out!);
  const descriptions =
    values.descriptions === 'none'
      ? null
      : {
          label: values
            .descriptions!.split('/')
            .pop()!
            .replace(/\.json$/, ''),
          file: loadRecording(resolve(values.descriptions!)),
        };
  const workDir = await mkdtemp(join(tmpdir(), 'taalcut-find-run-'));
  const session = await openFindSession({
    libraryDir: values.library!,
    workDir,
    ...(values['coreml-dir'] ? { coremlDir: resolve(values['coreml-dir']) } : {}),
    log,
  });
  try {
    const report = await runFindEval({
      ...session,
      libraryDb: resolve(values.db!),
      // A queries file of one's own leaves the owner set out: its answers name the committed queries.
      queries: mergeQueries(
        loadQueries(resolve(values.queries ?? join(DATA, 'queries.json'))),
        values.queries ? null : loadOwnerSet(DATA),
      ),
      descriptions,
      candidates,
      workDir,
      tier: 'recommended',
      log,
    });
    writeText(out, findMarkdown(report));
    writeJson(out.replace(/\.md$/, '') + '.json', report);
    for (const group of report.groups.filter((g) => g.group === 'all'))
      console.log(
        `${group.candidate}: recall@10 ${group.recallAt10.toFixed(3)}, MRR ${group.mrr.toFixed(3)} over ${group.queries} queries`,
      );
    console.log(`Wrote ${out}`);
  } finally {
    await session.close();
    await rm(workDir, { recursive: true, force: true });
  }
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  try {
    const args = cliArgs(argv);
    const rest = cliArgs(args.slice(1));
    if (args[0] === 'fetch') return await fetchCommand(rest);
    if (args[0] === 'index') return await indexCommand(rest);
    if (args[0] === 'record') return await recordCommand(rest);
    if (args[0] === 'run') return await runCommand(rest);
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
