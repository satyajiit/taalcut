// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 sbx in the jobs process: the workspace shell's jobs are registered, and the toolchain report says what the
 * shell has (the app's FFmpeg here) and what it lacks, never downloading in a test (no component manager).
 */
import { createContainer, ok, type JobContext } from '@taalcut/core';
import type { MediaService } from '@taalcut/media';
import { expect, it } from 'vitest';
import { shellRoot, workspaceShellJobs } from '../src/utility/roots/workspace-shell';
import { testConfig } from './helpers/roots';

const media = {
  binaries: async () => ok({ ffmpeg: '/app/ffmpeg/ffmpeg', ffprobe: '/app/ffmpeg/ffprobe' }),
} as unknown as MediaService;

it('registers workspace.shell and workspace.toolchain, and reports the toolchain without installing', async () => {
  const config = testConfig('jobs');
  const jobs = workspaceShellJobs(config, createContainer(), media);
  expect(jobs.map((job) => job.kind.kind)).toEqual(['workspace.shell', 'workspace.toolchain']);
  const toolchain = jobs[1]!;
  const report = await toolchain.handler({ install: true }, {
    signal: new AbortController().signal,
    progress: () => undefined,
  } as unknown as JobContext);
  expect(report.ok).toBe(true);
  const value = report.ok
    ? (report.value as { programs: { name: string }[]; missing: { name: string }[] })
    : null;
  expect(value?.programs.map((program) => program.name)).toEqual(
    expect.arrayContaining(['ffmpeg', 'ffprobe']),
  );
  expect(value?.missing.map((part) => part.name)).toEqual(
    expect.arrayContaining(['node', 'python3', 'hyperframes']),
  );
  expect(shellRoot(config.userData)).toBe(`${config.userData}/shell`);
});
