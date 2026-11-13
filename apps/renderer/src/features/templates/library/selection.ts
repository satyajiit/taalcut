// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library's multi-select (P3-V14), as plain state so it is unit tested apart from the list: Space or a click
 * on the box toggles one, Shift extends from the last one toggled, ⌘A takes every template in view, Escape lets
 * go. What leaves the view (a filter, a delete) leaves the selection.
 */
import type { TemplateId } from '@taalcut/core';

export interface Selection {
  readonly ids: ReadonlySet<TemplateId>;
  /** Where a Shift range starts: the last template toggled. */
  readonly anchor: TemplateId | null;
}

export const NO_SELECTION: Selection = { ids: new Set(), anchor: null };

export function toggle(selection: Selection, id: TemplateId): Selection {
  const ids = new Set(selection.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchor: id };
}

/** Adds every template from the anchor (or this one, with none) to `id`, in view order. */
export function extend(selection: Selection, order: readonly TemplateId[], id: TemplateId): Selection {
  const to = order.indexOf(id);
  if (to < 0) return selection;
  const anchor = selection.anchor !== null ? order.indexOf(selection.anchor) : -1;
  const from = anchor < 0 ? to : anchor;
  const ids = new Set(selection.ids);
  for (const item of order.slice(Math.min(from, to), Math.max(from, to) + 1)) ids.add(item);
  return { ids, anchor: selection.anchor ?? id };
}

export const selectAll = (order: readonly TemplateId[]): Selection => ({
  ids: new Set(order),
  anchor: order[0] ?? null,
});

/** Only what is still in view stays selected; the same object when nothing left. */
export function prune(selection: Selection, order: readonly TemplateId[]): Selection {
  if (selection.ids.size === 0) return selection;
  const visible = new Set(order);
  const ids = [...selection.ids].filter((id) => visible.has(id));
  if (ids.length === selection.ids.size) return selection;
  return {
    ids: new Set(ids),
    anchor: selection.anchor && visible.has(selection.anchor) ? selection.anchor : null,
  };
}

/** The selected templates in view order. */
export const selectedIn = (selection: Selection, order: readonly TemplateId[]): TemplateId[] =>
  order.filter((id) => selection.ids.has(id));
