// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Provider text is untrusted: drop control characters and angle brackets, then cap the length. */
export function plainText(value: string, max: number): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x3c || code === 0x3e) continue;
    out += value[i];
  }
  return out.slice(0, max);
}
