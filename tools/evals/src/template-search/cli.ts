// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The template search suite's commands (LRN1-TPL). */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Embedder } from '@taalcut/core';
import { DEFAULT_EMBEDDING_PROFILE } from '@taalcut/vision';
import { hashingEmbedder } from '../casting/library';
import { cliArgs, isDirectRun } from '../entry';
import { evalEmbedder } from '../search/eval-embedder';
import { loadTemplateLibrary } from '../template-fit/library';
import { writeTemplateSearchFixtures } from './fixtures';
import { predictTemplateSearch, scoreTemplateSearchDirs, writeTemplateSearchReport } from './run';
import { loadTemplateQueries } from './schema';
import { templateSearchSystem } from './system';

const USAGE = `Usage:
  eval:template-search --labels <dir> --predictions <dir> --out <report.md>
  predict:template-search --labels <dir> --library <dir>... --out <dir> [--model-dir <embeddinggemma-2>] [--work <empty dir>]
  fixtures:template-search --out <dir>

--library is a template library folder (templates/ and templates.json); repeat it for each library the labels name.
--model-dir embeds with EmbeddingGemma 2 as the app does; without it the eval's deterministic word embedder is used.`;

async function evalCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { labels: { type: 'string' }, predictions: { type: 'string' }, out: { type: 'string' } },
    strict: true,
  });
  if (values.labels === undefined || values.predictions === undefined || values.out === undefined)
    throw new Error(`${USAGE}\n--labels, --predictions and --out are required`);
  const report = scoreTemplateSearchDirs(resolve(values.labels), resolve(values.predictions));
  writeTemplateSearchReport(report, resolve(values.out));
  const overall = report.scores.rows[0];
  const synthetic = report.synthetic ? ' Synthetic: not a result to quote.' : '';
  console.log(
    `hit@5 ${overall?.hitAt5.toFixed(3)}, MRR ${overall?.meanReciprocalRank.toFixed(3)}, nDCG@5 ` +
      `${overall?.ndcgAt5.toFixed(3)} over ${overall?.queries} queries (${report.spaces.join(', ')}).${synthetic}`,
  );
  return 0;
}

/** EmbeddingGemma 2 from its folder, or the deterministic stand-in; and how to release it. */
async function embedderFor(modelDir: string | undefined, tempDir: string) {
  if (modelDir === undefined)
    return { embedder: hashingEmbedder() as Embedder, release: async () => undefined };
  // onnxruntime-node on macOS reports telemetry unless this is set before it loads.
  process.env.ORT_DISABLE_TELEMETRY = '1';
  const { embedder } = await evalEmbedder({
    modelDir,
    imageTokens: DEFAULT_EMBEDDING_PROFILE.imageTokens,
    tempDir,
    log: (line) => console.warn(`[template-search] ${line}`),
  });
  return { embedder: embedder as Embedder, release: () => embedder.close() };
}

async function predictCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      labels: { type: 'string' },
      out: { type: 'string' },
      library: { type: 'string', multiple: true },
      'model-dir': { type: 'string' },
      work: { type: 'string' },
    },
    strict: true,
  });
  if (values.labels === undefined || values.out === undefined || !values.library?.length)
    throw new Error(`${USAGE}\n--labels, --library and --out are required`);
  const libraries = Object.fromEntries(
    values.library.map((dir) => [loadTemplateLibrary(resolve(dir)).name, resolve(dir)]),
  );
  const workDir =
    values.work === undefined
      ? mkdtempSync(join(tmpdir(), 'taalcut-template-search-'))
      : resolve(values.work);
  mkdirSync(workDir, { recursive: true });
  const modelDir = values['model-dir'] === undefined ? undefined : resolve(values['model-dir']);
  const { embedder, release } = await embedderFor(modelDir, workDir);
  const system = templateSearchSystem({ libraries, embedder, workDir });
  try {
    const queries = loadTemplateQueries(resolve(values.labels));
    const written = await predictTemplateSearch(system, queries, resolve(values.out));
    console.log(`Wrote ${written.length} template search predictions to ${resolve(values.out)}`);
    return 0;
  } finally {
    await system.close();
    await release();
    if (values.work === undefined) rmSync(workDir, { recursive: true, force: true });
  }
}

function fixturesCommand(argv: string[]): number {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' } }, strict: true });
  if (values.out === undefined) throw new Error(`${USAGE}\n--out is required`);
  const written = writeTemplateSearchFixtures(resolve(values.out));
  console.log(`Wrote synthetic template library ${written.libraryDir} and queries ${written.labelsDir}`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  try {
    const args = cliArgs(argv);
    const command = args[0];
    const rest = cliArgs(args.slice(1));
    if (command === 'eval') return await evalCommand(rest);
    if (command === 'predict') return await predictCommand(rest);
    if (command === 'fixtures') return fixturesCommand(rest);
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
