// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A lineage's summary as stored: commands read it first, so their inverse can put the old value back. */
import {
  ok,
  type AsyncResult,
  type TemplateId,
  type TemplateStore,
  type TemplateSummary,
} from '@taalcut/core';

export async function storedSummary(
  store: TemplateStore,
  templateId: TemplateId,
): AsyncResult<TemplateSummary> {
  const stored = await store.get(templateId);
  return stored.ok ? ok(stored.value.summary) : stored;
}
