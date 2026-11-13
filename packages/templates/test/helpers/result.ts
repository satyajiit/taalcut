// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Narrow a Result in a test. A failure throws its code so the assertion never sees the error branch. */
import type { Result } from '@taalcut/core';

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

/** A field of a command result. Dispatch by name types that result as unknown. */
export function readField(value: unknown, key: string): unknown {
  if (typeof value === 'object' && value !== null && key in value) return Reflect.get(value, key);
  throw new Error(key);
}
