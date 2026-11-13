// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The processes the bench starts (the builds, Playwright, the footage generator), behind a port so the runner
 * is tested without them. Output goes to a log file and to this process's own output.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ShellStep {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Added to this process's environment; `undefined` removes a variable (NO_COLOR, for one). */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Appended to, with the command line first. */
  readonly log: string;
}

export interface Shell {
  /** Resolves to the exit code (a signal counts as 1). */
  run(step: ShellStep): Promise<number>;
}

function environment(extra: ShellStep['env']): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export function nodeShell(): Shell {
  return {
    run(step) {
      mkdirSync(dirname(step.log), { recursive: true });
      const log = createWriteStream(step.log, { flags: 'a' });
      log.write(`$ ${[step.command, ...step.args].join(' ')}\n`);
      return new Promise((resolve) => {
        const child = spawn(step.command, [...step.args], {
          cwd: step.cwd,
          env: environment(step.env),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const tee = (chunk: Buffer) => {
          log.write(chunk);
          process.stdout.write(chunk);
        };
        child.stdout.on('data', tee);
        child.stderr.on('data', tee);
        const finish = (code: number) => log.end(() => resolve(code));
        child.on('error', (error) => {
          log.write(`${error.message}\n`);
          finish(1);
        });
        child.on('close', (code) => finish(code ?? 1));
      });
    },
  };
}
