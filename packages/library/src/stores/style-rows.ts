// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Style rows ↔ core's Style and StyleSummary (P3-V10): the columns a Style fills (its kind, revision, the
 * template version a look was made from, the logo it names) and the document, read back through core's
 * styleSchema (which upgrades a P3-1 title card's seconds).
 */
import {
  err,
  ok,
  styleSchema,
  ValidationError,
  type Result,
  type Style,
  type StyleId,
  type StyleSummary,
} from '@taalcut/core';
import type { styles } from '../schema/styles';

export type StyleRow = typeof styles.$inferSelect;

/** A Style checked against core's schema: what the store writes, and what a read returns. */
export function parsedStyle(value: unknown): Result<Style> {
  const parsed = styleSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(ValidationError({ field: 'style' }, { detail: parsed.error.message.slice(0, 2000) }));
}

export function styleColumns(style: Style): StyleRow {
  return {
    id: style.id,
    name: style.name,
    kind: style.kind,
    revision: style.revision,
    schemaVersion: style.schemaVersion,
    document: style,
    madeFromTemplateId: style.madeFrom?.templateId ?? null,
    madeFromVersion: style.madeFrom?.version ?? null,
    logoAsset: style.logo?.asset ?? null,
    createdAt: style.createdAt,
    updatedAt: style.updatedAt,
  };
}

export function styleSummary(style: Style, defaultStyle: StyleId | null): StyleSummary {
  const { logo } = style;
  return {
    id: style.id,
    name: style.name,
    kind: style.kind,
    revision: style.revision,
    colours: style.colours,
    logo: logo
      ? { asset: logo.asset, mediaType: logo.mediaType, width: logo.width, height: logo.height }
      : null,
    isDefault: style.id === defaultStyle,
    updatedAt: style.updatedAt,
  };
}
