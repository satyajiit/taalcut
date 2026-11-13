// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { spawn } from 'node:child_process';
import { testCores } from './cores.ts';

// Script tests share the same allocation as package tests, including when called directly.
let cores;
try {
  cores = testCores();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
const child = spawn(process.execPath, ['--test', `--test-concurrency=${cores}`, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.once('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
child.once('exit', (code) => process.exit(code ?? 1));
