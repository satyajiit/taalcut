// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Run on the M1 test Mac. Results never imply the first-time editor study passed. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cpus, totalmem, platform, release } from 'node:os';

const mode = process.argv[2];
if (!['--m1', '--study'].includes(mode)) {
  console.error('Usage: node scripts/verify-edt2.mjs --m1 | --study [output-directory]');
  process.exit(2);
}
const out = resolve(process.argv[3] ?? `artifacts/edt2-${new Date().toISOString().replaceAll(':', '-')}`);
mkdirSync(out, { recursive: true });
const facts = {
  measuredAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
  chip: cpus()[0]?.model,
  cores: cpus().length,
  memoryBytes: totalmem(),
  platform: platform(),
  os: release(),
};
writeFileSync(resolve(out, 'machine.json'), JSON.stringify(facts, null, 2) + '\n');
if (mode === '--study') {
  const heading =
    'participant,first_time_editor,consent,ai_edit,inspect,undo,manual_edit,export,coaching,completed,minutes,notes\n';
  writeFileSync(
    resolve(out, 'study.csv'),
    heading + Array.from({ length: 5 }, (_, i) => `P${i + 1},,,,,,,,,,,`).join('\n') + '\n',
  );
  console.log(
    `Study sheet: ${out}/study.csv\nFollow docs/validation/edt2-manual.md. Result remains pending until five people complete the session.`,
  );
  process.exit(0);
}
if (facts.platform !== 'darwin' || !/^Apple M1$/.test(facts.chip ?? '')) {
  console.error(
    `M1 gate not run: this machine is ${facts.chip}. Use the base M1 Mac, ideally 8 GB. Facts saved in ${out}.`,
  );
  process.exit(2);
}
const commands = [
  ['--filter', '@taalcut/desktop', 'e2e:provision'],
  ['--filter', '@taalcut/desktop', 'e2e:perf'],
];
for (const args of commands) {
  const result = spawnSync('pnpm', args, {
    stdio: 'inherit',
    env: { ...process.env, TAALCUT_PERF_DIR: out, TAALCUT_TEST_CORES: '4' },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(
  `Measurements saved in ${out}. Complete the 60-second background-work protocol in docs/validation/edt2-manual.md; the automatic preview fixture is 30 seconds.`,
);
