// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `eval:shots` (IX2-C1): scores shot boundaries against a footage manifest's cuts and dissolves, from stored
 * libraries (`--library`, e.g. each bench run's index-library.sqlite) and detector runs (`--predictions`, as
 * `predict:shots` writes them). Each input is its own section of the report. `predict:shots` runs a detector
 * on the set's clips (predict.ts). A run whose clips another detector decided than its name says (a TransNetV2 run
 * with a clip that fell back to scdet) is refused (decider.ts).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs, isDirectRun } from '../entry';
import { readJson, writeJson, writeText } from '../files';
import { parseNamed } from '../schema';
import { misattributedClips } from './decider';
import { reportDetector, shotsMarkdown, type DetectorReport } from './report';
import { shotLabelsSchema, shotPredictionsSchema } from './schema';
import { requireMediaBinaries } from '../media-bin';
import { parseDetector, predictShots, SHOT_DETECTORS } from './predict';
import { openShotsRoute } from './service-route';
import { SHOT_TOLERANCE_FRAMES } from './score';
import { storedPredictions } from './stored';

const USAGE = `Usage:
  taalcut-evals shots eval --manifest <manifest.json> [--library <library.sqlite>]... [--predictions <run.json>]...
                           [--tolerance <frames>] [--out <report.md>]

  taalcut-evals shots predict --manifest <manifest.json> --out <run.json> --detector <detector>[@fps]...
                              [--rounds <n>] [--footage <dir>] [--embedder-dir <dir>] [--model-dir <dir>]
                              [--coreml-dir <dir>] [--clip <file>]... [--cancel-after <ms>]

--manifest is a footage set's manifest.json (its clips' cuts and dissolves are the labels).
--out also writes <report>.json; without it the report is printed.
predict reads the clips next to the manifest (or in --footage). EmbeddingGemma 2 (scdet's confirm) and
TransNetV2 come from TAALCUT_EMBEDDINGGEMMA_2_DIR / TAALCUT_TRANSNETV2_DIR (and its Core ML build from
TAALCUT_TRANSNETV2_COREML_DIR), else packages/vision/.cache.
Detectors: scdet; transnetv2-coreml runs the model on Core ML in the mac helper, as the app does first on a Mac;
transnetv2 in a process of its own on ONNX Runtime, as the app does without the Core ML build; transnetv2-inline
on the pass's thread (the app before IX2-S2). @fps caps the model's stream rate
(default the app's), e.g. transnetv2@15. Several detectors and rounds run interleaved per clip; each run is written
next to --out as <out>-<detector>-r<round>.json (a single run: --out itself). --cancel-after cancels each clip that
long in and records how long it took to stop (not for scoring).
The analysis pass decodes as the app's does, from TAALCUT_DECODE_SERVICE: where it gives the pass to the decode
service (the mac helper), each clip goes through vision's shots job with it; @fps then needs =frames.`;

const VISION_CACHE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../packages/vision/.cache');

export function evalShots(argv: string[]): { markdown: string; reports: DetectorReport[] } {
  const { values } = parseArgs({
    args: argv,
    options: {
      manifest: { type: 'string' },
      library: { type: 'string', multiple: true },
      predictions: { type: 'string', multiple: true },
      tolerance: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  if (values.manifest === undefined) throw new Error(`${USAGE}\n--manifest is required`);
  const manifestPath = resolve(values.manifest);
  const labels = parseNamed(shotLabelsSchema, readJson(manifestPath), manifestPath);
  const tolerance = values.tolerance === undefined ? SHOT_TOLERANCE_FRAMES : Number(values.tolerance);
  if (!Number.isInteger(tolerance) || tolerance < 0)
    throw new Error('--tolerance must be a whole number of frames');
  const fps = new Map(labels.clips.map((clip) => [clip.file, clip.fps]));
  const inputs = [
    ...(values.library ?? []).map((path) => storedPredictions(resolve(path), (file) => fps.get(file))),
    ...(values.predictions ?? []).map((path) =>
      parseNamed(shotPredictionsSchema, readJson(resolve(path)), resolve(path)),
    ),
  ];
  if (inputs.length === 0) throw new Error(`${USAGE}\nat least one --library or --predictions is required`);
  for (const input of inputs) {
    const wrong = misattributedClips(input);
    if (wrong.length > 0)
      throw new Error(
        `${input.detector}: another detector decided ${wrong.join(', ')}; not scored as ${input.detector}`,
      );
  }
  const reports = inputs.map((input) => reportDetector(labels, input, tolerance));
  const markdown = shotsMarkdown(labels.set, reports);
  if (values.out !== undefined) {
    const out = resolve(values.out);
    writeText(out, markdown);
    writeJson(out.replace(/\.md$/, '') + '.json', { set: labels.set, reports });
  }
  return { markdown, reports };
}

/** Where a run is written: --out for a single run, else next to it by detector and round. */
function runPath(out: string, single: boolean, detector: string, round: number): string {
  return single ? out : `${out.replace(/\.json$/, '')}-${detector}-r${round}.json`;
}

async function predict(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      manifest: { type: 'string' },
      detector: { type: 'string', multiple: true },
      rounds: { type: 'string' },
      out: { type: 'string' },
      footage: { type: 'string' },
      'embedder-dir': { type: 'string' },
      'model-dir': { type: 'string' },
      'coreml-dir': { type: 'string' },
      clip: { type: 'string', multiple: true },
      'cancel-after': { type: 'string' },
    },
    strict: true,
  });
  const positive = (flag: string, text: string | undefined) => {
    if (text === undefined) return undefined;
    const value = Number(text);
    if (!(value > 0)) throw new Error(`--${flag} must be a positive number`);
    return value;
  };
  const cancelAfterMs = positive('cancel-after', values['cancel-after']);
  const rounds = positive('rounds', values.rounds) ?? 1;
  const detectors = (values.detector ?? []).map((text) => {
    const spec = parseDetector(text);
    if (!spec)
      throw new Error(`${USAGE}
unknown detector ${text} (${SHOT_DETECTORS.join('|')}, model ones @fps)`);
    return spec;
  });
  if (values.manifest === undefined || values.out === undefined || detectors.length === 0)
    throw new Error(`${USAGE}
--manifest, --detector and --out are required`);
  const manifestPath = resolve(values.manifest);
  const labels = parseNamed(shotLabelsSchema, readJson(manifestPath), manifestPath);
  const binaries = await requireMediaBinaries();
  const footageDir = resolve(values.footage ?? dirname(manifestPath));
  const log = (line: string) => console.warn(`[shots] ${line}`);
  // The pass decodes where the app's would: the decode service when the switch gives it the pass (IX3-R1).
  const route = await openShotsRoute({ footageDir, log });
  const runs = await predictShots(labels, {
    detectors,
    rounds: Math.round(rounds),
    footageDir,
    media: { binaries },
    embedderDir: resolve(
      values['embedder-dir'] ??
        process.env.TAALCUT_EMBEDDINGGEMMA_2_DIR ??
        resolve(VISION_CACHE, 'embeddinggemma-2'),
    ),
    modelDir: resolve(
      values['model-dir'] ?? process.env.TAALCUT_TRANSNETV2_DIR ?? resolve(VISION_CACHE, 'transnetv2'),
    ),
    coremlDir: resolve(
      values['coreml-dir'] ??
        process.env.TAALCUT_TRANSNETV2_COREML_DIR ??
        resolve(VISION_CACHE, 'transnetv2-coreml'),
    ),
    ...(values.clip ? { clips: values.clip } : {}),
    ...(cancelAfterMs !== undefined ? { cancelAfterMs } : {}),
    ...(route ? { route } : {}),
    log,
  }).finally(() => route?.close());
  const out = resolve(values.out);
  for (const { round, run } of runs) writeJson(runPath(out, runs.length === 1, run.detector, round), run);
}

export async function main(argv: string[]): Promise<number> {
  try {
    const args = cliArgs(argv);
    const rest = cliArgs(args.slice(1));
    if (args[0] === 'eval') {
      console.log(evalShots(rest).markdown);
      return 0;
    }
    if (args[0] === 'predict') {
      await predict(rest);
      return 0;
    }
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
