// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a remembered item applies, as Settings → Memory chooses it (LRN1-MEM): a kind (every video, a project, a
 * template) and, for a project or template, which one. Core's memoryItemProblems says which scopes an item may take:
 * what an export taught stays with a template, learned casting weights stay with every video.
 */
import {
  MEMORY_SCOPES,
  memoryItemProblems,
  newId,
  parseId,
  type MemoryItem,
  type MemoryItemView,
  type MemoryScope,
} from '@taalcut/core';
import type { MemoryScopeKind, MemoryScopeOption } from '@taalcut/ui';

export interface ScopeChoice {
  readonly kind: MemoryScopeKind;
  readonly target: MemoryScopeOption | null;
}

export const EVERY_VIDEO: ScopeChoice = { kind: 'user', target: null };

/** The scope a choice names; null while a project or template is still to be chosen. */
export function scopeOf({ kind, target }: ScopeChoice): MemoryScope | null {
  if (kind === 'user') return { kind: 'user' };
  if (!target) return null;
  if (kind === 'project') {
    const projectId = parseId<'Project'>(target.id);
    return projectId.ok ? { kind, projectId: projectId.value } : null;
  }
  const templateId = parseId<'Template'>(target.id);
  return templateId.ok ? { kind, templateId: templateId.value } : null;
}

/** The choice an item's scope is now, with its name: where its editor starts. */
export function choiceOf(item: Pick<MemoryItemView, 'scope' | 'scopeName'>): ScopeChoice {
  const { scope } = item;
  if (scope.kind === 'user') return EVERY_VIDEO;
  const id = scope.kind === 'project' ? scope.projectId : scope.templateId;
  return { kind: scope.kind, target: { id, name: item.scopeName ?? '' } };
}

type Facts = Pick<MemoryItem, 'source' | 'data' | 'conversationId'>;

/** What is wrong with the item in this scope (core's memoryItemProblems); empty when it may go there. */
export function scopeProblems(item: Facts, scope: MemoryScope): string[] {
  return memoryItemProblems({ ...item, scope });
}

/** A scope of each kind, to ask core about the kind alone (its rules read the kind, not the id). */
const ANY: Readonly<Record<MemoryScopeKind, MemoryScope>> = {
  user: { kind: 'user' },
  project: { kind: 'project', projectId: newId<'Project'>() },
  template: { kind: 'template', templateId: newId<'Template'>() },
};

/** The kinds the item can't move to: shown, disabled. */
export function disabledKinds(item: Facts): MemoryScopeKind[] {
  const refused = (kind: MemoryScopeKind) => scopeProblems(item, ANY[kind]).length > 0;
  return MEMORY_SCOPES.filter(refused);
}

export function sameScope(a: MemoryScope, b: MemoryScope): boolean {
  if (a.kind === 'project' && b.kind === 'project') return a.projectId === b.projectId;
  if (a.kind === 'template' && b.kind === 'template') return a.templateId === b.templateId;
  return a.kind === b.kind && a.kind === 'user';
}

const words = (text: string) =>
  text
    .normalize('NFC')
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean);

/** The ones whose name holds every word of the query as the start of one of its words, in the given order. */
export function matching(options: readonly MemoryScopeOption[], query: string): MemoryScopeOption[] {
  const terms = words(query);
  if (terms.length === 0) return [...options];
  return options.filter((option) => {
    const name = words(option.name);
    return terms.every((term) => name.some((word) => word.startsWith(term)));
  });
}
