// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Errors the job engine raises. Timeouts use core's TimeoutError (retryable). */
import { defineError } from '@taalcut/core';

/** No handler or definition is registered for this job kind. */
export const UnknownJobKind = defineError<{ kind: string }>('jobs.unknown_job_kind');
/** A handler threw something that isn't a TaalcutError. Retried, since it may be transient. */
export const JobHandlerFailed = defineError<{ kind: string }>('jobs.handler_failed', { retryable: true });
/** A handler's result failed the kind's output schema. Not retried: the handler would return it again. */
export const JobOutputInvalid = defineError<{ kind: string }>('jobs.output_invalid');
/** The job is not in a state that allows this change (MemoryJobStore). */
export const InvalidJobState = defineError<{ state: string }>('jobs.invalid_job_state');
