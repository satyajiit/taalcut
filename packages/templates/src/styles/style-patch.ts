// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Apply a brand-kit patch (P3-V10). Any field but id and kind; colours, fonts and the caption look are the
 * Style schema's, and a logo watermark still needs a logo (`styleProblems`).
 */
import {
  err,
  ok,
  styleProblems,
  styleSchema,
  ValidationError,
  type Result,
  type Style,
  type StyleInput,
} from '@taalcut/core';

export type StylePatch = Partial<Omit<StyleInput, 'kind'>>;

export function applyStylePatch(style: Style, patch: StylePatch): Result<Style> {
  if (Object.keys(patch).length === 0)
    return err(ValidationError({ field: 'patch' }, { detail: 'Nothing to change' }));
  const parsed = styleSchema.safeParse({ ...style, ...patch, id: style.id, kind: style.kind });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.map(String).join('.') || 'style';
    return err(ValidationError({ field }, { detail: parsed.error.issues[0]?.message ?? 'Invalid style' }));
  }
  const problems = styleProblems(parsed.data);
  const problem = problems[0];
  if (problem) return err(ValidationError({ field: 'style' }, { detail: problem }));
  return ok(parsed.data);
}
