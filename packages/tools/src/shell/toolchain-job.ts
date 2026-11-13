// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `workspace.toolchain` job (AGT2 sbx): `workspace.open` asks the jobs process, where the component manager is,
 * what the shell has, installing the toolchain components that aren't there yet (on first use, as the reference
 * fetcher's are). A component that can't be installed now (offline, a network that refuses components.taalcut.app)
 * is reported missing with its error code; the shell still opens with what it has.
 */
import { defineJobKind, NO_RETRY, registerJob, type AsyncResult, type JobRegistration } from '@taalcut/core';
import { z } from 'zod';

export const toolchainReportSchema = z.object({
  programs: z.array(z.object({ name: z.string(), version: z.string() })),
  missing: z.array(z.object({ name: z.string(), reason: z.string() })),
});
export type ToolchainReport = z.output<typeof toolchainReportSchema>;

export const workspaceToolchainJob = defineJobKind({
  kind: 'workspace.toolchain',
  input: z.object({ install: z.boolean() }),
  output: toolchainReportSchema,
  resource: 'network',
  priority: 'high',
  retry: NO_RETRY,
  // Three components on a slow link.
  timeoutMs: 30 * 60_000,
  resumable: false,
});

export interface ToolchainSource {
  report(options: { readonly install: boolean; readonly signal?: AbortSignal }): AsyncResult<ToolchainReport>;
}

/** The jobs process registers this beside the shell's own job. */
export function createToolchainJobs(source: ToolchainSource): JobRegistration[] {
  return [
    registerJob(workspaceToolchainJob, (input, context) =>
      source.report({ install: input.install, signal: context.signal }),
    ),
  ];
}
