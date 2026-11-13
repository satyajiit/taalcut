// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: `pnpm --filter @taalcut/evals eval:make -- [options]`: a make's last stretch on made-up reels and a
 * made-up library (cases.ts, footage.ts): draft, fix what differs from the reel, finish with video.done.
 * - `--stand-in`: the scripted stand-in (stand-in.ts): the harness end to end, anywhere.
 * - `--plan chatgpt --model <id> [--reasoning <level>]`: the person's ChatGPT plan, through the evals' own sign-in
 *   (`eval:signin chatgpt`); every line and file the run writes goes through its scrub.
 * - `--base-url <url> --model <id>`: a model behind an OpenAI-compatible endpoint, its key TAALCUT_EVAL_API_KEY.
 * - `--live`: the on-device 9B through the app's own runtime (edit/live.ts: TAALCUT_MLX_SERVER, TAALCUT_MLX_9B),
 *   with no bar.
 * - `--cases a,b` runs those; `--out <dir>` gets make.json and make.md.
 * Exits 1 when a barred run misses the bar (report.ts).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ReasoningLevelSchema } from '@taalcut/models';
import type { DesignerModel } from '@taalcut/render';
import { designModels } from '../design/models';
import { clientDesigner } from '../design/plan-designer';
import { LOCAL_CALL_LIMITS } from '../design/openai-designer';
import { scrubbedValue } from '../design/design-mode';
import { startLiveModel, type LiveModel } from '../edit/live';
import { MAKE_CASES } from './cases';
import { makeReport, makeReportMarkdown } from './report';
import { runMakeCase, type MakeModel, type MakeRun } from './run';
import { standInMaker } from './stand-in';

async function main() {
  const { values } = parseArgs({
    options: {
      'stand-in': { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
      plan: { type: 'string' },
      model: { type: 'string', default: 'qwen3.5-9b' },
      reasoning: { type: 'string' },
      'base-url': { type: 'string' },
      'api-key': { type: 'string' },
      cases: { type: 'string', default: '' },
      out: { type: 'string', default: join(import.meta.dirname, '..', '..', 'make', 'out') },
    },
  });
  const wanted = values.cases
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const cases = MAKE_CASES.filter((made) => wanted.length === 0 || wanted.includes(made.id));
  if (cases.length === 0) throw new Error(`No case ${values.cases}`);
  let live: LiveModel | undefined;
  let model: MakeModel;
  let label: string;
  let scrub = (text: string) => text;
  if (values['stand-in']) {
    model = standInMaker;
    label = 'stand-in';
  } else if (values.live) {
    const server = process.env.TAALCUT_MLX_SERVER;
    const weights = process.env.TAALCUT_MLX_9B;
    if (!server || !weights) throw new Error('--live needs TAALCUT_MLX_SERVER and TAALCUT_MLX_9B');
    live = await startLiveModel({ server: resolve(server), weights: resolve(weights) });
    model = clientDesigner({ client: live.client, seesImages: false, scrub, ...LOCAL_CALL_LIMITS });
    label = `${live.name} (on-device)`;
  } else {
    if (!values.plan && !values['base-url'])
      throw new Error('give --stand-in, --live, --plan chatgpt or --base-url');
    const reasoning =
      values.reasoning === undefined ? undefined : ReasoningLevelSchema.parse(values.reasoning);
    const models = await designModels(
      {
        standIn: false,
        model: values.model,
        vision: false,
        ...(values.plan ? { plan: values.plan } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(values['base-url'] ? { baseUrl: values['base-url'] } : {}),
        apiKey: values['api-key'] ?? process.env.TAALCUT_EVAL_API_KEY ?? '',
      },
      null,
    );
    model = models.live as DesignerModel;
    scrub = models.scrub;
    label = models.label();
  }
  const runs: MakeRun[] = [];
  try {
    for (const made of cases) {
      const started = Date.now();
      const run = await runMakeCase(made, model);
      runs.push(run);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        scrub(
          `${run.done ? 'done' : 'NOT DONE'} ${made.id}: slots ${run.before.slotsMatched}/${run.before.slots} → ` +
            `${run.after.slotsMatched}/${run.after.slots}, ${run.rounds} drafts, ${run.turns} turns, ${seconds} s` +
            (run.error ? ` (${run.error})` : ''),
        ),
      );
    }
  } finally {
    await live?.stop();
  }
  const report = scrubbedValue(makeReport(label, runs, !values.live), scrub);
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'make.json'), `${JSON.stringify(report, null, 1)}\n`);
  await writeFile(join(out, 'make.md'), makeReportMarkdown(report));
  console.log(
    `${report.model}: slots ${Math.round(report.after.slotsMatched * 100)} %, needs ${Math.round(report.after.needsMet * 100)} %, ` +
      `done ${report.done}/${report.cases}, median drafts ${report.medianRounds}; ` +
      (report.barred ? `bar ${report.meetsBar ? 'met' : `not met (${report.misses.join(', ')})`}` : 'no bar'),
  );
  console.log(`report: ${join(out, 'make.md')}`);
  if (!report.meetsBar) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
