// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The JSON value of `text`, or undefined when it isn't JSON: no schema accepts undefined, so the caller's check refuses it. */
export function jsonValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON is an answer (undefined), not a fault.
    return undefined;
  }
}
