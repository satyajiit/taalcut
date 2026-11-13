// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Parse a JSON object. Callers check the values. */
export function readJsonObject(
  text: string,
  invalid: string,
  shape: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: invalid };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: shape };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}
