// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { Id, ProjectId, Result, TaalcutError, TEMPLATE_COMMANDS, Template } from '@taalcut/core';
import { useState } from 'react';
import { toast } from '../feedback/toast-store';

type SlotId = Id<'TemplateSlot'>;

/** What a person can do to a template's slots from the breakdown (P2-T6). Each is one bus command. */
export type SlotEdit =
  | { readonly kind: 'rename'; readonly index: number; readonly name: string | null }
  | { readonly kind: 'merge'; readonly index: number }
  | { readonly kind: 'drop'; readonly index: number }
  | { readonly kind: 'approve'; readonly indices: readonly number[]; readonly approved: boolean };

// The kit imports only types from core: the names are written out and checked against core's.
const RENAME: (typeof TEMPLATE_COMMANDS)['renameSlot'] = 'template.slot.rename';
const MERGE: (typeof TEMPLATE_COMMANDS)['mergeSlots'] = 'template.slot.merge';
const DROP: (typeof TEMPLATE_COMMANDS)['dropSlot'] = 'template.slot.drop';
const APPROVE: (typeof TEMPLATE_COMMANDS)['approveSlots'] = 'template.slot.approve';

/**
 * The command for an edit, made on the version on screen (`baseVersion`): if
 * someone else changed the template first, the bus answers `core.conflict`
 * rather than editing a version nobody saw.
 */
export function slotEditCommand(
  template: Template,
  projectId: ProjectId | null,
  edit: SlotEdit,
): { name: string; payload: unknown } {
  const base = { projectId, templateId: template.id, baseVersion: template.version };
  const id = (index: number): SlotId => template.slots[index]!.id;
  switch (edit.kind) {
    case 'rename':
      return { name: RENAME, payload: { ...base, slotId: id(edit.index), name: edit.name } };
    case 'merge':
      return { name: MERGE, payload: { ...base, slotIds: [id(edit.index), id(edit.index + 1)] } };
    case 'drop':
      return { name: DROP, payload: { ...base, slotId: id(edit.index) } };
    case 'approve':
      return { name: APPROVE, payload: { ...base, slotIds: edit.indices.map(id), approved: edit.approved } };
  }
}

export interface SlotEditsOptions {
  template: Template;
  projectId: ProjectId | null;
  dispatch?: ((name: string, payload: unknown) => Promise<Result<unknown>>) | undefined;
  /** The Undo on the toast after a merge or a drop: the same as ⌘Z. */
  undo?: (() => Promise<Result<unknown>>) | undefined;
}

/**
 * Runs slot edits as commands. Changes you can see are silent (DESIGN.md:
 * success is silent); a merge or a drop, which removes a slot from view,
 * says so in a toast with Undo. A failure stays on the panel as one line.
 */
export function useSlotEdits({ template, projectId, dispatch, undo }: SlotEditsOptions) {
  const { t, i18n } = useLingui();
  const [pending, setPending] = useState<SlotEdit['kind'] | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);

  async function run(edit: SlotEdit): Promise<boolean> {
    if (!dispatch) return false;
    const { name, payload } = slotEditCommand(template, projectId, edit);
    setPending(edit.kind);
    setError(null);
    const result = await dispatch(name, payload);
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    if (edit.kind === 'drop' || edit.kind === 'merge') {
      const n = i18n.number(edit.index + 1);
      const next = i18n.number(edit.index + 2);
      toast({
        title: edit.kind === 'drop' ? t`Slot ${n} dropped` : t`Slots ${n} and ${next} merged`,
        ...(undo ? { action: { label: t`Undo`, onSelect: () => void undo() } } : {}),
      });
    }
    return true;
  }

  return { run, pending, error, clearError: () => setError(null), canEdit: Boolean(dispatch) };
}
