// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `study:search` (IX2-U1): the search ranking study.
 * - `embed` embeds the probes' texts once (under the VideoToolbox lock) into a query-vector file.
 * - `run` scores fusion candidates over stored libraries on the CPU, from that file.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cliArgs, isDirectRun } from '../../entry';
import { writeJson, writeText } from '../../files';
import { embedProbes } from './embed-probes';
import { studyProbes } from './labels';
import { studyMarkdown } from './report';
import { runStudy, type LibraryInput } from './run';
import { loadProbes } from './schema';
import { STUDY_CANDIDATES } from './candidates';

const USAGE = `Usage:
  study:search embed --vectors <query-vectors.json> [--probes <probes.json>] [--model-dir <dir>] [--coreml-dir <dir>]
  study:search run --vectors <query-vectors.json> --library <label>=<library.sqlite>... --out <report.md>
                   [--probes <probes.json>] [--candidate <id>]...

--library is a stored library (a bench run's index-library.sqlite, a search eval's library.db); it is copied
next to --out and only the copy is opened. Its set (ix-v1 or the search eval's) is read from its assets.
Candidates: ${STUDY_CANDIDATES.map((c) => c.id).join(', ')} (default all).
embed loads EmbeddingGemma 2 on the GPU or Neural Engine: run it under the VideoToolbox lock.`;

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROBES = resolve(HERE, '../../../search-study/probes.json');
const VISION_CACHE = resolve(HERE, '../../../../../packages/vision/.cache');

function libraryInput(value: string): LibraryInput {
  const at = value.indexOf('=');
  if (at <= 0) throw new Error(`--library ${value}: write it as <label>=<path>`);
  const label = value.slice(0, at);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(label))
    throw new Error(`--library label ${label}: lowercase words and hyphens`);
  return { label, path: resolve(value.slice(at + 1)) };
}

async function embed(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      vectors: { type: 'string' },
      probes: { type: 'string' },
      'model-dir': { type: 'string' },
      'coreml-dir': { type: 'string' },
    },
    strict: true,
  });
  if (values.vectors === undefined) throw new Error(`${USAGE}\n--vectors is required`);
  const out = resolve(values.vectors);
  const probes = studyProbes(loadProbes(resolve(values.probes ?? DEFAULT_PROBES)));
  await embedProbes({
    texts: probes.map((probe) => probe.text),
    out,
    modelDir: resolve(values['model-dir'] ?? join(VISION_CACHE, 'embeddinggemma-2')),
    ...(values['coreml-dir'] !== undefined ? { coremlDir: resolve(values['coreml-dir']) } : {}),
    workDir: join(dirname(out), 'embed-tmp'),
    log: (line) => console.warn(`[study] ${line}`),
  });
  return 0;
}

async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      vectors: { type: 'string' },
      library: { type: 'string', multiple: true },
      out: { type: 'string' },
      probes: { type: 'string' },
      candidate: { type: 'string', multiple: true },
    },
    strict: true,
  });
  if (values.vectors === undefined || values.out === undefined || !values.library?.length)
    throw new Error(`${USAGE}\n--vectors, --library and --out are required`);
  const wanted = values.candidate ?? STUDY_CANDIDATES.map((c) => c.id);
  const candidates = wanted.map((id) => {
    const found = STUDY_CANDIDATES.find((c) => c.id === id);
    if (!found) throw new Error(`unknown candidate ${id}`);
    return found;
  });
  const out = resolve(values.out);
  const report = await runStudy({
    probes: studyProbes(loadProbes(resolve(values.probes ?? DEFAULT_PROBES))),
    vectors: resolve(values.vectors),
    libraries: values.library.map(libraryInput),
    candidates,
    workDir: join(dirname(out), 'libraries'),
  });
  writeText(out, studyMarkdown(report));
  writeJson(out.replace(/\.md$/, '') + '.json', report);
  console.log(`Wrote ${out}`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  try {
    const args = cliArgs(argv);
    const rest = cliArgs(args.slice(1));
    if (args[0] === 'embed') return await embed(rest);
    if (args[0] === 'run') return await run(rest);
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
