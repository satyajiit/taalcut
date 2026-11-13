// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A comma-separated flag as numbers, each one of `allowed`; throws naming the first that isn't. */
export function numberList<T extends number>(text: string, allowed: readonly T[], what: string): T[] {
  return text.split(',').map((part) => {
    const found = allowed.find((value) => String(value) === part.trim());
    if (found === undefined) throw new Error(`${what} ${part} is not one of ${allowed.join(', ')}`);
    return found;
  });
}
