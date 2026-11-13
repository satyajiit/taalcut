// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The experiment sandbox's errors (P2-T2). Params never hold paths or URLs:
 * those go in `detail`, which stays developer-only.
 */
import { defineError } from '@taalcut/core';

export const SandboxProgramNotAllowed = defineError<{ program: string }>('sandbox.program_not_allowed');
export const SandboxArgumentRejected = defineError<{ index: number; reason: string }>(
  'sandbox.argument_rejected',
);
export const SandboxPathOutside = defineError<{ index: number } | undefined>('sandbox.path_outside');
export const SandboxCpuLimit = defineError<{ seconds: number }>('sandbox.cpu_limit');
export const SandboxTimeLimit = defineError<{ ms: number }>('sandbox.time_limit', { retryable: true });
export const SandboxDiskLimit = defineError<{ bytes: number }>('sandbox.disk_limit');
export const SandboxExperimentNotFound = defineError('sandbox.experiment_not_found');
/** The experiment's folder could not be removed (detail: the file system's reason). The next sweep tries again. */
export const SandboxDiscardFailed = defineError('sandbox.discard_failed', { retryable: true });
export const SandboxUnavailable = defineError('sandbox.unavailable');
