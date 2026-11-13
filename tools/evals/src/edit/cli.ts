// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: `pnpm --filter @taalcut/evals edit:requests` — the edit eval.
 *
 *   edit:requests                      replays the recorded sessions (edit/sessions/*.json), as CI does
 *   edit:requests --live [--record]    runs the 9B on MLX (live.ts; TAALCUT_MLX_SERVER, TAALCUT_MLX_9B) and, with
 *                                      --record, keeps each case's session for the replay. AGT2: the agent reads the
 *                                      model's window as the app does (it sizes the tool offer); --no-window: as before
 *   --case a,b                         only these cases;  --out <dir>  where report.md and report.json go
 *   --sessions <dir>                   replays the sessions kept there instead (a past run's, to score it again)
 *
 * Exits 1 when the bar isn't met (report.ts).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { EDIT_CASES } from './cases';
import { startLiveModel, type LiveModel } from './live';
import { editReport, editReportMarkdown } from './report';
import { runCase, type CaseRun } from './run';
import { sessionOf, type Session } from './session';

export const SESSIONS_DIR = join(import.meta.dirname, '..', '..', 'edit', 'sessions');

export function loadSession(caseId: string, dir = SESSIONS_DIR): Session | undefined {
  const file = join(dir, `${caseId}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Session) : undefined;
}

async function main() {
  const { values } = parseArgs({
    options: {
      live: { type: 'boolean', default: false },
      // AGT2: a live run reads the model's window as the app does; --no-window runs it as before (smallest offer).
      'no-window': { type: 'boolean', default: false },
      record: { type: 'boolean', default: false },
      case: { type: 'string' },
      sessions: { type: 'string' },
      out: { type: 'string', default: join(import.meta.dirname, '..', '..', 'edit', 'out') },
    },
  });
  const wanted = values.case?.split(',').map((id) => id.trim());
  const cases = EDIT_CASES.filter((edit) => !wanted || wanted.includes(edit.id));
  if (cases.length === 0) throw new Error(`No case ${values.case}`);
  let live: LiveModel | undefined;
  if (values.live) {
    const server = process.env.TAALCUT_MLX_SERVER;
    const weights = process.env.TAALCUT_MLX_9B;
    if (!server || !weights) throw new Error('--live needs TAALCUT_MLX_SERVER and TAALCUT_MLX_9B');
    live = await startLiveModel({ server: resolve(server), weights: resolve(weights) });
  }
  const runs: CaseRun[] = [];
  const model = live
    ? `${live.name}${values['no-window'] ? ', no window (the smallest offer)' : ', offer by its window'}`
    : 'recorded';
  const recordedModels = new Set<string>();
  try {
    for (const edit of cases) {
      const replay = live
        ? undefined
        : loadSession(edit.id, values.sessions ? resolve(values.sessions) : SESSIONS_DIR);
      if (!live && !replay)
        throw new Error(`No recorded session for ${edit.id}: record it with --live --record`);
      if (replay) recordedModels.add(replay.model);
      const started = Date.now();
      const window = live && !values['no-window'] ? { window: live.window } : {};
      const { run, turns } = await runCase(
        edit,
        live ? { live: live.client, ...window } : { replay: replay! },
      );
      runs.push(run);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `${run.pass ? 'pass' : 'FAIL'} ${edit.id} (${run.turns} turns, ${seconds} s)${run.pass ? '' : `: ${run.why}`}`,
      );
      if (live && values.record) {
        mkdirSync(SESSIONS_DIR, { recursive: true });
        const session = sessionOf(edit.id, live.name, { pass: run.pass, why: run.why }, turns);
        writeFileSync(join(SESSIONS_DIR, `${edit.id}.json`), `${JSON.stringify(session, null, 1)}\n`);
      }
    }
  } finally {
    await live?.stop();
  }
  const report = editReport(
    recordedModels.size ? [...recordedModels].join(' + ') : model,
    live ? 'live' : 'replay',
    runs,
  );
  mkdirSync(values.out, { recursive: true });
  writeFileSync(join(values.out, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
  writeFileSync(join(values.out, 'report.md'), editReportMarkdown(report));
  console.log(
    `non-graphics ${report.nonGraphics.passed}/${report.nonGraphics.n} (${(report.nonGraphics.rate * 100).toFixed(1)}%), malformed ${report.malformedNonGraphics} (${report.malformed} with graphics), out of target ${report.outOfTarget}; bar ${report.meetsBar ? 'met' : 'not met'}`,
  );
  console.log(`report: ${join(values.out, 'report.md')}`);
  if (!report.meetsBar) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
