// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Error mapping between Taalcut's error model and oRPC.
 *
 * Over the wire every failure is one oRPC error code, 'TAALCUT', whose data is
 * the TaalcutError itself, so code, messageKey, params, fix and retryable all
 * arrive unchanged. The server maps whatever a handler throws (a TaalcutError,
 * an oRPC input-validation error, a plain Error) into that shape; the client
 * maps it back with fromRpcError and never sees an oRPC type.
 */
import { ORPCError } from '@orpc/client';
import { ValidationError as OrpcValidationError } from '@orpc/contract';
import { taalcutErrorSchema } from '../basics/error-schema';
import {
  CancelledError,
  isTaalcutError,
  NotFoundError,
  toTaalcutError,
  UnknownError,
  ValidationError,
  type TaalcutError,
} from '../basics/errors';
import { err, ok, type AsyncResult, type Result } from '../basics/result';

export const RPC_ERROR_CODE = 'TAALCUT';

/** Every contract declares this error map (the `ipc` builder does it for you), so errors arrive typed. */
export const RPC_ERRORS = { [RPC_ERROR_CODE]: { data: taalcutErrorSchema } } as const;

export type RpcError = ORPCError<typeof RPC_ERROR_CODE, TaalcutError>;

export function toRpcError(error: TaalcutError): RpcError {
  return new ORPCError(RPC_ERROR_CODE, { data: error, message: error.code });
}

/** For handlers: the value of an Ok, or throw the Err so it crosses the wire as a TaalcutError. */
export function unwrapRpc<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw toRpcError(result.error);
}

function describeIssues(cause: OrpcValidationError): { field?: string; detail: string } {
  const paths = cause.issues.map((issue) =>
    (issue.path ?? []).map((p) => String(typeof p === 'object' ? p.key : p)),
  );
  const field = paths[0]?.join('.') || undefined;
  const detail = cause.issues
    .map((issue, i) => `${paths[i]?.join('.') || '(input)'}: ${issue.message}`)
    .join('; ');
  return { field, detail };
}

/** The error as a page may see it: code, message key, params, fix and retryable, without `detail`. */
export function withoutDetail(error: TaalcutError): TaalcutError {
  if (error.detail === undefined) return error;
  const { detail: _detail, ...rest } = error;
  return rest;
}

const isPlainObject = (value: object): value is Record<string, unknown> => {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
};

/** Deeper than any contract's data; a value nested past it is left as it is. */
const MAX_DETAIL_DEPTH = 64;

function stripDetails(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object' || depth > MAX_DETAIL_DEPTH) return value;
  if (Array.isArray(value)) {
    let copy: unknown[] | undefined;
    value.forEach((item: unknown, i) => {
      const next = stripDetails(item, depth + 1);
      if (next !== item) (copy ??= [...value])[i] = next;
    });
    return copy ?? value;
  }
  if (!isPlainObject(value)) return value;
  let copy: Record<string, unknown> | undefined;
  for (const [key, item] of Object.entries(value)) {
    const next = stripDetails(item, depth + 1);
    if (next !== item) (copy ??= { ...value })[key] = next;
  }
  const result = copy ?? value;
  return isTaalcutError(result) ? withoutDetail(result) : result;
}

/**
 * `value` with `detail` dropped from every TaalcutError inside it (an event's
 * error, a card's, a job's), for anything served to a window. Returns `value`
 * itself when there is nothing to drop.
 */
export function withoutDetails<T>(value: T): T {
  return stripDetails(value, 0) as T;
}

function toTaalcutErrorFromServer(cause: unknown): TaalcutError {
  if (cause instanceof ORPCError) {
    if (cause.code === RPC_ERROR_CODE && isTaalcutError(cause.data)) return cause.data;
    if (cause.code === 'BAD_REQUEST' && cause.cause instanceof OrpcValidationError) {
      const { field, detail } = describeIssues(cause.cause);
      return ValidationError(field ? { field } : undefined, { detail });
    }
    return UnknownError(undefined, { detail: `${String(cause.code)}: ${cause.message}` });
  }
  return toTaalcutError(cause);
}

export interface ServerErrorOptions {
  /**
   * Keep `detail` (developer text that may hold a copied Error.message). Only
   * between Taalcut's own processes: utility → main. Never to a page.
   */
  readonly exposeDetail?: boolean;
}

/** Server side: anything a procedure throws, as the one wire error. Drops `detail` unless told not to (`exposeDetail`). */
export function toServerRpcError(cause: unknown, options: ServerErrorOptions = {}): RpcError {
  const error = toTaalcutErrorFromServer(cause);
  return toRpcError(options.exposeDetail ? error : withoutDetail(error));
}

/** Client side: any rejection from an oRPC client, as a TaalcutError. */
export function fromRpcError(cause: unknown): TaalcutError {
  if (cause instanceof ORPCError) {
    if (cause.code === RPC_ERROR_CODE && isTaalcutError(cause.data)) return cause.data;
    if (cause.code === 'BAD_REQUEST') return ValidationError(undefined, { detail: cause.message });
    if (cause.code === 'NOT_FOUND') return NotFoundError({ entity: 'procedure' }, { detail: cause.message });
    return UnknownError(undefined, { detail: `${String(cause.code)}: ${cause.message}` });
  }
  if (cause instanceof Error && cause.name === 'AbortError') return CancelledError();
  return toTaalcutError(cause);
}

/** Awaits an oRPC call and returns a Result instead of throwing. */
export async function callRpc<T>(call: Promise<T>): AsyncResult<T> {
  try {
    return ok(await call);
  } catch (cause) {
    return err(fromRpcError(cause));
  }
}
