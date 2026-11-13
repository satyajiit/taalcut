// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A scripted JobRunner: records each run, plays progress, returns what the test says. */
import type { JobProgress, Result } from '@taalcut/core';
import type { JobRunner, JobRunOptions } from '@taalcut/media';

export interface FakeJobRunner extends JobRunner {
  readonly calls: { kind: string; input: unknown; options: JobRunOptions }[];
}

export function fakeJobRunner(
  answer: (kind: string, input: unknown) => Result<unknown> | Promise<Result<unknown>>,
  progress: readonly JobProgress[] = [],
): FakeJobRunner {
  const calls: FakeJobRunner['calls'] = [];
  return {
    calls,
    async run(kind, input, options = {}) {
      calls.push({ kind: kind.kind, input, options });
      for (const step of progress) options.onProgress?.(step);
      // The real runner validates with kind.output; a script returns what the kind declares.
      return (await answer(kind.kind, input)) as Result<never>;
    },
  };
}
