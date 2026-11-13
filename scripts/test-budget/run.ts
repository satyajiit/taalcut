// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { testBudget, turboRuns } from './budget.ts';
import { TEST_CORES_ENV, testCores } from './cores.ts';

const TURBO = join(import.meta.dirname, '..', '..', 'node_modules', '.bin', 'turbo');
const TASKS = new Set(['test', 'test:coverage']);

/** Runs one turbo process and resolves with its exit code; a turbo that can't start is a failure. */
function turbo(args: readonly string[], running: Set<ReturnType<typeof spawn>>): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(TURBO, args, { stdio: 'inherit' });
    running.add(child);
    child.on('error', (error) => {
      console.error(`[tests] turbo ${args.join(' ')} didn't start: ${error.message}`);
      resolve(1);
    });
    child.on('close', (code, signal) => {
      running.delete(child);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

/** `pnpm test` and `pnpm test:coverage`: the repo's tests within the machine's budget (budget.ts). */
export async function run(argv: readonly string[]): Promise<number> {
  const [task, ...args] = argv;
  if (!task || !TASKS.has(task)) {
    console.error(
      'usage: node scripts/test-budget.mjs test|test:coverage [turbo arguments] [-- vitest arguments]',
    );
    return 2;
  }
  const machine = availableParallelism();
  let cores: number;
  try {
    cores = testCores(process.env, machine);
  } catch (error) {
    console.error(`[tests] ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const budget = testBudget(cores);
  const share = cores === machine ? `${cores} cores` : `${cores} of ${machine} cores (${TEST_CORES_ENV})`;
  console.log(
    `[tests] ${share}: render on its own from the start; the other packages ${budget.tasks} at a time, ` +
      `${budget.workers} test files each`,
  );
  const running = new Set<ReturnType<typeof spawn>>();
  // Ctrl-C reaches both turbo runs from the terminal; a kill of this process (heavy.sh, CI) is passed on.
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      for (const child of running) child.kill(signal);
    });
  const codes = await Promise.all(
    turboRuns(task, budget, args).map((turboArgs) => turbo(turboArgs, running)),
  );
  return codes.some((code) => code !== 0) ? 1 : 0;
}
