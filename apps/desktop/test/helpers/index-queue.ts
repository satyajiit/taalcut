// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Real job registrations as handlers of the library's test queue (`@taalcut/library/test-support`), so a desktop
 * test runs the library's indexing pipeline over them: each input checked by its kind as the engine does, a plain
 * job context, and every failure kept as `<kind>: <code> <detail>`.
 */
import { err, ValidationError, type JobId, type JobRegistration } from '@taalcut/core';
import type { StubHandler } from '@taalcut/library/test-support';

export function registrationHandlers(
  registrations: readonly JobRegistration[],
  failures: string[],
): Record<string, StubHandler> {
  const run = (registration: JobRegistration) => async (input: unknown, jobId: JobId) => {
    const parsed = registration.kind.input.safeParse(input);
    const outcome = parsed.success
      ? await registration.handler(parsed.data, {
          jobId,
          projectId: null,
          attempt: 1,
          signal: new AbortController().signal,
          progress: () => undefined,
        })
      : err(ValidationError({ field: 'input' }, { detail: parsed.error.message }));
    if (!outcome.ok)
      failures.push(`${registration.kind.kind}: ${outcome.error.code} ${outcome.error.detail ?? ''}`);
    return outcome;
  };
  return Object.fromEntries(registrations.map((registration) => [registration.kind.kind, run(registration)]));
}
