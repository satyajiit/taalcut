// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Memory's groups (LRN1-MEM): what applies to every video first, then each project's, then each
 * template's, each group newest first as the list came (the list is newest first). A project or template comes in
 * the order of its newest item.
 */
import type { MemoryItemView, MemoryScopeKind } from '@taalcut/core';

export interface MemoryGroup {
  /** 'user', or the project's or template's id. */
  readonly key: string;
  readonly kind: MemoryScopeKind;
  /** The project's or template's name (user content); null for every video, or when it has none. */
  readonly name: string | null;
  readonly items: readonly MemoryItemView[];
}

const ORDER: Readonly<Record<MemoryScopeKind, number>> = { user: 0, project: 1, template: 2 };

const keyOf = (item: MemoryItemView): string =>
  item.scope.kind === 'project'
    ? item.scope.projectId
    : item.scope.kind === 'template'
      ? item.scope.templateId
      : 'user';

export function memoryGroups(items: readonly MemoryItemView[]): MemoryGroup[] {
  const groups = new Map<string, { kind: MemoryScopeKind; name: string | null; items: MemoryItemView[] }>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? { kind: item.scope.kind, name: item.scopeName, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, ...group }))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}
