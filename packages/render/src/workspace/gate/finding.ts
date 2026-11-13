// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A workspace finding (HFW1 "hf: gate, lower"): what the gate or the lowering refused in a composition, said so the
 * model that wrote it can act on it. Every finding carries a fix hint; HyperFrames' own lint findings keep theirs.
 */
export interface WorkspaceFinding {
  /** `hf.<lint code>` for HyperFrames' lint, `gate.<rule>` for Taalcut's allowlists, `lower.<rule>` for the script. */
  readonly code: string;
  readonly severity: 'error' | 'warning';
  /** What is wrong, quoting the part (shortened) where it helps. */
  readonly message: string;
  /** What to write instead. */
  readonly fixHint: string;
  /** The workspace file it is in, when known. */
  readonly file?: string;
}

export const refusal = (code: string, message: string, fixHint: string): WorkspaceFinding => ({
  code,
  severity: 'error',
  message,
  fixHint,
});

/** A quoted excerpt for a message: one line, at most `max` characters. */
export const excerpt = (text: string, max = 60): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

export type Gated<T> =
  | { readonly ok: true; readonly value: T; readonly warnings: readonly WorkspaceFinding[] }
  | { readonly ok: false; readonly findings: readonly WorkspaceFinding[] };
