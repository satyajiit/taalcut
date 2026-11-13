// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Packages hand out readonly values; a contract's handler returns its zod
 * schema's (mutable) output. `toWire` copies one into the other. The shapes
 * are the same by construction, and oRPC validates every output against the
 * contract on the way out, so a drift fails loudly rather than silently.
 */

export type Wire<T> = T extends readonly (infer U)[]
  ? Wire<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Wire<T[K]> }
    : T;

export const toWire = <T>(value: T): Wire<T> => structuredClone(value) as Wire<T>;

/** Each value of a stream, copied (see toWire). */
export async function* wireStream<T>(values: AsyncIterable<T>): AsyncGenerator<Wire<T>, void, undefined> {
  for await (const value of values) yield toWire(value);
}
