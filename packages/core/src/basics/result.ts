// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Result<T, E>: the return type of every operation that can fail in a way the
 * caller should handle. Exceptions are for bugs; Results are for outcomes.
 * See packages/core/SPEC.md, "Result and errors".
 */
import { CancelledError, type TaalcutError, toTaalcutError } from './errors';

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E = TaalcutError> = Ok<T> | Err<E>;
export type AsyncResult<T, E = TaalcutError> = Promise<Result<T, E>>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

export function andThen<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** Returns the value or throws the error. Use only in tests and at process edges. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error instanceof Error ? result.error : new UnwrapError(result.error);
}

export class UnwrapError extends Error {
  constructor(readonly error: unknown) {
    super(`unwrap() called on an Err: ${describe(error)}`);
    this.name = 'UnwrapError';
  }
}

/** Runs a function that may throw and turns a throw into an Err. */
export function attempt<T>(
  fn: () => T,
  mapError: (cause: unknown) => TaalcutError = toTaalcutError,
): Result<T> {
  try {
    return ok(fn());
  } catch (cause) {
    return err(mapError(cause));
  }
}

/** Awaits a promise that may reject and turns a rejection into an Err. */
export async function attemptAsync<T>(
  fn: () => Promise<T>,
  mapError: (cause: unknown) => TaalcutError = toTaalcutError,
): AsyncResult<T> {
  try {
    return ok(await fn());
  } catch (cause) {
    return err(mapError(cause));
  }
}

/** Collects an array of Results into one: all values, or the first error. */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

/**
 * `work`, or `core.cancelled` as soon as `signal` aborts (already aborted: at once). The work itself goes on; its
 * result is dropped. For waits a cancel must cut short: a model loading, a process starting.
 */
export function raceAbort<T>(work: AsyncResult<T>, signal: AbortSignal | undefined): AsyncResult<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.resolve(err(CancelledError()));
  return new Promise((resolve) => {
    const onAbort = () => resolve(err(CancelledError()));
    signal.addEventListener('abort', onAbort, { once: true });
    void work.then((result) => {
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    });
  });
}

function describe(value: unknown): string {
  if (value && typeof value === 'object' && 'code' in value) return String((value as { code: unknown }).code);
  return String(value);
}
