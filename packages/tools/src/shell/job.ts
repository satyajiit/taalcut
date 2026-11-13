// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `workspace.shell` job kind (AGT2 sbx): how the agent process's workspace tools run a command in the jobs
 * process, where children start. One command in one project's shell folder; the folder comes from the project id
 * under the jobs process's own root, never from a path in the input.
 */
import { defineJobKind, idSchema, NO_RETRY } from '@taalcut/core';
import { z } from 'zod';
import { SHELL_MAX_WALL_MS, SHELL_OUTPUT } from './limits';
import { SHELL_STOPS } from './run-shell';

/** The longest command one call may send. */
export const MAX_COMMAND_CHARS = 16 * 1024;

export const shellRequestSchema = z.object({
  command: z.string().min(1).max(MAX_COMMAND_CHARS),
  wallMs: z.int().min(1000).max(SHELL_MAX_WALL_MS),
  stdoutBytes: z.int().min(256).max(SHELL_OUTPUT.stdoutMax),
  stderrBytes: z.int().min(256).max(SHELL_OUTPUT.stderrMax),
});

export const shellRunResultSchema = z.object({
  exitCode: z.int(),
  stdout: z.string().meta({ untrusted: 'sandbox' }),
  stderr: z.string().meta({ untrusted: 'sandbox' }),
  durationMs: z.number().nonnegative(),
  stopped: z.enum(SHELL_STOPS).nullable(),
  peakMemoryBytes: z.number().nonnegative(),
});

export const workspaceShellJob = defineJobKind({
  kind: 'workspace.shell',
  input: z.object({ projectId: idSchema<'Project'>(), request: shellRequestSchema }),
  output: shellRunResultSchema,
  resource: 'cpu',
  priority: 'high',
  retry: NO_RETRY,
  // The longest wall clock a call may ask for, plus time to end the tree and read its output.
  timeoutMs: SHELL_MAX_WALL_MS + 30_000,
  resumable: false,
});
