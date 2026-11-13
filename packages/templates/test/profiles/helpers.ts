// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Doubles for the style profile service's tests: an in-memory StyleProfileStore whose sets' members a test sets by
 * hand, and an open template index holding the golden set's slot vectors under their real ids.
 */
import {
  err,
  NotFoundError,
  ok,
  styleSourceKey,
  type ProjectId,
  type StyleProfileRecord,
  type StyleProfileStore,
  type StyleSource,
  type Template,
  type TemplateRef,
} from '@taalcut/core';
import type { OpenTemplateIndex } from '../../src/profiles/build-profile';
import { NO_SYNC } from '../../src/vectors/sync';
import { slotIntentText } from '../../src/vectors/texts';
import { intentVectorId } from '../../src/vectors/vector-set';
import { goldenVectors } from './golden-set';

export interface MemoryStyleStore extends StyleProfileStore {
  /** The set's members (null: the set is gone). */
  setMembers(source: StyleSource, members: readonly TemplateRef[] | null): void;
  readonly puts: StyleProfileRecord[];
}

export function memoryStyleStore(): MemoryStyleStore {
  const members = new Map<string, readonly TemplateRef[] | null>();
  const records = new Map<string, StyleProfileRecord>();
  const projects = new Map<ProjectId, StyleSource | null>();
  const puts: StyleProfileRecord[] = [];
  const gone = (source: StyleSource) =>
    err(NotFoundError({ entity: 'styleSource', id: styleSourceKey(source) }));
  return {
    puts,
    setMembers: (source, refs) => void members.set(styleSourceKey(source), refs),
    async members(source) {
      const found = members.get(styleSourceKey(source));
      return found === null ? gone(source) : ok([...(found ?? [])]);
    },
    async sourceName(source) {
      if (members.get(styleSourceKey(source)) === null) return gone(source);
      return ok(source.kind === 'my-exports' ? null : `Set ${styleSourceKey(source)}`);
    },
    get: async (source) => ok(records.get(styleSourceKey(source)) ?? null),
    list: async () => ok([...records.values()].map(({ source, digest }) => ({ source, digest }))),
    async put(record) {
      puts.push(record);
      records.set(styleSourceKey(record.source), record);
      return ok(undefined);
    },
    async setSummary(source, digest, summary) {
      const record = records.get(styleSourceKey(source));
      if (!record || record.digest !== digest) return ok(false);
      records.set(styleSourceKey(source), { ...record, summary });
      return ok(true);
    },
    remove: async (source) => ok(void records.delete(styleSourceKey(source))),
    projectStyle: async (projectId) => ok(projects.get(projectId) ?? null),
    async setProjectStyle(projectId, source) {
      projects.set(projectId, source);
      return ok(undefined);
    },
  };
}

/** An open template index with the golden vectors under each golden slot's intent id. */
export function goldenIndex(
  templates: readonly Template[],
  name = 'lib_tpl',
): OpenTemplateIndex & { syncs: number } {
  const stored = new Map<string, Float32Array>();
  for (const set of goldenVectors()) {
    const template = templates.find((candidate) => candidate.id === set.templateId);
    template?.slots.forEach((slot, index) => {
      const vector = set.vectors[index];
      if (vector) stored.set(intentVectorId(template.id, slot.id, slotIntentText(slot) ?? ''), vector);
    });
  }
  const index = {
    index: name,
    syncs: 0,
    vectors: {
      async sync() {
        index.syncs++;
        return ok(NO_SYNC);
      },
      get: (ids: readonly string[]) =>
        ok(
          new Map(
            ids.flatMap((id) => (stored.has(id) ? [[id, stored.get(id) as Float32Array] as const] : [])),
          ),
        ),
    },
  };
  return index;
}
