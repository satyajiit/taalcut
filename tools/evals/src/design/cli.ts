// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `pnpm --filter @taalcut/evals eval:design -- [options]`: the Designer on 24 made-up requests (cases.ts).
 * - `--stand-in`: the scripted stand-in (stand-in.ts), stills that draw nothing: the tools end to end, anywhere.
 * - `--base-url <url> --model <id> [--vision]`: a model behind an OpenAI-compatible endpoint (a cloud model; `--vision`
 *   when it takes images, so the stills go to it as pictures). Its key is TAALCUT_EVAL_API_KEY from the environment,
 *   so it never shows in the process list (`--api-key` still works for a key that needn't be kept).
 * - `--binary <taalcut-mlx-server> --weights <folder> [--model qwen3.5-9b]`: the 9B on this Mac (heavy).
 * - `--plan chatgpt --model <id> [--reasoning <level>]`: the person's ChatGPT plan, as their app runs it (provider
 *   openai on the ChatGPT sign-in, through @taalcut/models' client: plan/chatgpt.ts). It needs the evals' own sign-in
 *   (`eval:signin chatgpt`, kept in ~/.taalcut-eval/credentials.json), never the app's; every line and file the run
 *   writes goes through the sign-in's scrub.
 * - `--frames real` (default for a model) draws real stills with render's engine over a made-up clip; `stand-in`
 *   draws none. `--judge-base-url --judge-model` scores each placed graphic's stills, with TAALCUT_EVAL_JUDGE_API_KEY
 *   (else TAALCUT_EVAL_API_KEY) as its key; `--judge-plan chatgpt --judge-model <id>` scores them on the plan.
 * - `--cases a,b` runs those; `--out <dir>` gets design.json, design.md and the contact sheet.
 * - `--template`: the template Designer on made-up reels instead (template-mode.ts); `--out` gets design.json,
 *   design.md and each case's stills.
 * Exits 1 when the run misses the bar.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ReasoningLevelSchema } from '@taalcut/models';
import { designMode } from './design-mode';
import { startMlxServer, type RunningServer } from './mlx-server';
import { designModels } from './models';
import { templateMode } from './template-mode';

const { values } = parseArgs({
  options: {
    'stand-in': { type: 'boolean', default: false },
    template: { type: 'boolean', default: false },
    'base-url': { type: 'string' },
    'api-key': { type: 'string' },
    plan: { type: 'string' },
    reasoning: { type: 'string' },
    model: { type: 'string', default: 'qwen3.5-9b' },
    vision: { type: 'boolean', default: false },
    binary: { type: 'string' },
    weights: { type: 'string' },
    frames: { type: 'string' },
    'judge-base-url': { type: 'string' },
    'judge-api-key': { type: 'string' },
    'judge-plan': { type: 'string' },
    'judge-model': { type: 'string' },
    cases: { type: 'string', default: '' },
    out: { type: 'string', default: '.' },
  },
});

const standIn = values['stand-in'];
const out = resolve(values.out);
const root = await mkdtemp(join(tmpdir(), 'taalcut-eval-design-'));
let server: RunningServer | null = null;
try {
  if (!standIn && !values['base-url'] && !values.plan) {
    if (!values.binary || !values.weights)
      throw new Error('give --stand-in, --base-url, --plan chatgpt, or --binary and --weights');
    server = await startMlxServer({ binary: values.binary, weights: values.weights, model: values.model });
  }
  const reasoning = values.reasoning === undefined ? undefined : ReasoningLevelSchema.parse(values.reasoning);
  const models = await designModels(
    {
      standIn,
      model: values.model,
      vision: values.vision,
      ...(values.plan ? { plan: values.plan } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(values['base-url'] ? { baseUrl: values['base-url'] } : {}),
      apiKey: values['api-key'] ?? process.env.TAALCUT_EVAL_API_KEY ?? '',
      ...(values['judge-plan'] ? { judgePlan: values['judge-plan'] } : {}),
      ...(values['judge-base-url'] ? { judgeBaseUrl: values['judge-base-url'] } : {}),
      judgeApiKey:
        values['judge-api-key'] ??
        process.env.TAALCUT_EVAL_JUDGE_API_KEY ??
        process.env.TAALCUT_EVAL_API_KEY ??
        '',
      ...(values['judge-model'] ? { judgeModel: values['judge-model'] } : {}),
    },
    server,
  );
  const frames = (values.frames ?? (standIn ? 'stand-in' : 'real')) === 'real' ? 'real' : 'stand-in';
  const cases = values.cases.split(',').filter(Boolean);
  if (values.template) {
    const report = await templateMode({
      root,
      out,
      cases,
      frames,
      live: models.live,
      label: models.label,
      scrub: models.scrub,
      ...(standIn ? {} : { designerId: values.model, onDevice: server !== null }),
    });
    process.exitCode = report.passed === report.total ? 0 : 1;
  } else {
    const report = await designMode({
      root,
      out,
      cases,
      frames,
      live: models.live,
      judge: models.judge,
      label: models.label,
      scrub: models.scrub,
    });
    process.exitCode = report.meetsBar ? 0 : 1;
  }
} finally {
  await server?.stop();
  await rm(root, { recursive: true, force: true });
}
