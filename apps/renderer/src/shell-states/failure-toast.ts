// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { FixAction, TaalcutError } from '@taalcut/core';
import { errorMessage, fixLabel, fixOn, toast, type HostPlatform, type ToastOptions } from '@taalcut/ui';

const TRY_AGAIN = msg({ id: 'commands.failed.retry', message: 'Try again' });

/** What a failure toast's button does: run the error's fix, or the same thing again. */
export interface FailureActions {
  readonly fix: (fix: FixAction) => void;
  readonly retry: () => void;
}

/**
 * The toast for a command that failed (DESIGN.md "Toasts": they are for failures): the error's own sentence,
 * which names the cause, and one button, its fix or else Try again when trying again can help. Stopping
 * something on purpose is not a failure, so a cancelled command shows nothing. Undefined when no toast is due. A fix
 * that opens a part of the system `platform` lacks isn't offered (fixOn).
 */
export function failureToastOptions(
  i18n: I18n,
  error: TaalcutError,
  actions: FailureActions,
  platform: HostPlatform = 'mac',
): ToastOptions | undefined {
  if (error.code === 'core.cancelled') return undefined;
  const fix = fixOn(error.fix, platform);
  const action = fix
    ? { label: fixLabel(i18n, fix), onSelect: () => actions.fix(fix) }
    : error.retryable
      ? { label: i18n._(TRY_AGAIN), onSelect: actions.retry }
      : undefined;
  return { tone: 'danger', title: errorMessage(i18n, error), ...(action ? { action } : {}) };
}

/** Shows the failure toast for `error`, when one is due. */
export function failureToast(
  i18n: I18n,
  error: TaalcutError,
  actions: FailureActions,
  platform: HostPlatform = 'mac',
): void {
  const options = failureToastOptions(i18n, error, actions, platform);
  if (options) toast(options);
}
