// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reading a template version for casting, assembly and "find something else".
 * Template v1 is the only version, so core's templateSchema reads it; when
 * the templates lane adds a v2, this switches to its migrateTemplate.
 *
 * REF1: whether a template keeps its reel with sound, so assembly makes the
 * reel's own music a new timeline's default. The media store's answer counts
 * when there is one (it also knows the file is still there); else the
 * template summary's `media`.
 */
import {
  err,
  NotFoundError,
  ok,
  TEMPLATE_SCHEMA_VERSION,
  templateSchema,
  ValidationError,
  type AsyncResult,
  type Template,
  type TemplateId,
  type TemplateMediaStore,
  type TemplateRef,
  type TemplateStore,
} from '@taalcut/core';
import { TemplateNotFound, UnsupportedSchema } from '../errors';

export interface TemplateReader {
  /** The version `ref` names; the head when `version` is omitted. */
  read(ref: { readonly id: TemplateRef['id']; readonly version?: number }): AsyncResult<Template>;
  /** REF1: true when the template keeps its reel and the reel has sound. Absent: no template keeps one. */
  keptAudio?(templateId: TemplateId): AsyncResult<boolean>;
}

export function storeTemplateReader(
  store: Pick<TemplateStore, 'get'>,
  media?: Pick<TemplateMediaStore, 'get'>,
): TemplateReader {
  return {
    async keptAudio(templateId) {
      if (media) {
        const kept = await media.get(templateId);
        return kept.ok ? ok(kept.value?.media.hasAudio === true) : kept;
      }
      const stored = await store.get(templateId);
      if (!stored.ok) return NotFoundError.is(stored.error) ? ok(false) : stored;
      return ok(stored.value.summary.media?.hasAudio === true);
    },
    async read(ref) {
      const stored = await store.get(ref.id, ref.version);
      if (!stored.ok)
        return NotFoundError.is(stored.error) ? err(TemplateNotFound({ templateId: ref.id })) : stored;
      if (stored.value.schemaVersion !== TEMPLATE_SCHEMA_VERSION)
        return err(UnsupportedSchema({ schemaVersion: stored.value.schemaVersion }));
      const parsed = templateSchema.safeParse(stored.value.json);
      if (!parsed.success)
        return err(ValidationError({ field: 'template' }, { detail: parsed.error.issues[0]?.message ?? '' }));
      return ok(parsed.data);
    },
  };
}

/** Templates held in memory (tests, and the brief path's format plan before it is stored); `withAudio` keep a reel. */
export function memoryTemplateReader(
  templates: readonly Template[],
  withAudio: readonly TemplateId[] = [],
): TemplateReader {
  return {
    keptAudio: async (templateId) => ok(withAudio.includes(templateId)),
    async read(ref) {
      const matches = templates.filter((template) => template.id === ref.id);
      const found =
        ref.version === undefined
          ? matches.sort((a, b) => b.version - a.version)[0]
          : matches.find((template) => template.version === ref.version);
      return found ? ok(found) : err(TemplateNotFound({ templateId: ref.id }));
    },
  };
}
