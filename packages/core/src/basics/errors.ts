// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The error model. Every error a user can see has a stable code, an i18n
 * message key, optional message parameters and an optional fix action (PRD 9.4:
 * "every error names the cause and offers a fix button").
 *
 * Errors are plain, serialisable objects so they cross IPC unchanged. `detail`
 * carries developer-only text (never shown outside developer mode).
 */

/** A command the UI can dispatch to fix the problem, shown as a button. */
export interface FixAction {
  /** Command name on the command bus, e.g. 'settings.open'. */
  readonly command: string;
  /** i18n key for the button label, e.g. 'fix.openSettings'. */
  readonly labelKey: string;
  readonly payload?: unknown;
}

export type ErrorParams = Readonly<Record<string, string | number | boolean>>;

export interface TaalcutError {
  /** Stable, namespaced code: '<package>.<snake_case>', e.g. 'media.probe_failed'. */
  readonly code: string;
  /** i18n message key. By convention 'errors.' + code. */
  readonly messageKey: string;
  readonly params?: ErrorParams;
  /** True when trying again later may succeed (network, rate limit, restart). */
  readonly retryable: boolean;
  readonly fix?: FixAction;
  /** Developer-only detail: never shown to users outside developer mode, never contains secrets. */
  readonly detail?: string;
}

export interface ErrorDefinition<P extends ErrorParams | undefined = ErrorParams | undefined> {
  readonly code: string;
  (params?: P, extras?: { detail?: string; fix?: FixAction }): TaalcutError;
  /** True if `value` is an error with this definition's code. */
  is(value: unknown): value is TaalcutError;
}

const CODE_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;
const registry = new Map<string, { retryable: boolean; fix?: FixAction }>();

/**
 * Declares an error code once, next to the code that raises it.
 *
 *   export const ProbeFailed = defineError('media.probe_failed', { retryable: false });
 *   return err(ProbeFailed({ file: name }, { detail: stderr }));
 */
export function defineError<P extends ErrorParams | undefined = ErrorParams | undefined>(
  code: string,
  options: { retryable?: boolean; fix?: FixAction } = {},
): ErrorDefinition<P> {
  if (!CODE_PATTERN.test(code))
    throw new Error(`Invalid error code '${code}': use '<package>.<snake_case>'.`);
  if (registry.has(code)) throw new Error(`Error code '${code}' is defined twice.`);
  const retryable = options.retryable ?? false;
  registry.set(code, { retryable, ...(options.fix ? { fix: options.fix } : {}) });

  const factory = (params?: P, extras: { detail?: string; fix?: FixAction } = {}): TaalcutError => {
    const fix = extras.fix ?? options.fix;
    return {
      code,
      messageKey: `errors.${code}`,
      retryable,
      ...(params ? { params } : {}),
      ...(fix ? { fix } : {}),
      ...(extras.detail ? { detail: extras.detail } : {}),
    };
  };
  return Object.assign(factory, {
    code,
    is: (value: unknown): value is TaalcutError => isTaalcutError(value) && value.code === code,
  }) as ErrorDefinition<P>;
}

/** Every error code defined so far in this process (used to check the i18n catalogue). */
export function definedErrorCodes(): string[] {
  return [...registry.keys()].sort();
}

/** Each error defined so far that carries its own fix, with that fix (a test checks every fix names a command). */
export function definedErrorFixes(): ReadonlyMap<string, FixAction> {
  return new Map([...registry].flatMap(([code, { fix }]) => (fix ? [[code, fix] as const] : [])));
}

export function isTaalcutError(value: unknown): value is TaalcutError {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === 'string' && typeof v.messageKey === 'string' && typeof v.retryable === 'boolean';
}

/* Errors every package can raise. */
export const UnknownError = defineError('core.unknown');
export const ValidationError = defineError<{ field?: string } | undefined>('core.validation');
export const NotFoundError = defineError<{ entity: string; id?: string } | undefined>('core.not_found');
export const CancelledError = defineError('core.cancelled');
export const TimeoutError = defineError<{ ms: number } | undefined>('core.timeout', { retryable: true });
export const ProcessRestartedError = defineError<{ process: string } | undefined>('core.process_restarted', {
  retryable: true,
});
export const NotImplementedError = defineError<{ feature: string } | undefined>('core.not_implemented');
/** An optimistic check failed: someone else changed the record first. Re-read and decide. */
export const ConflictError = defineError<{ entity: string; id?: string } | undefined>('core.conflict');

const ERROR_NAME = /^[A-Za-z_$][\w$.]{0,63}$/;

/**
 * Turns anything thrown into a TaalcutError. `detail` is only the thrown error's name ('TypeError'),
 * never its message or the value: `detail` is logged and crosses IPC, and a message can hold a token,
 * a path or a connection string. Log the original where it was caught if you need it.
 */
export function toTaalcutError(cause: unknown): TaalcutError {
  if (isTaalcutError(cause)) return cause;
  if (cause instanceof Error && cause.name === 'AbortError') return CancelledError();
  const detail =
    cause instanceof Error ? (ERROR_NAME.test(cause.name) ? cause.name : 'Error') : `thrown ${typeof cause}`;
  return UnknownError(undefined, { detail });
}
