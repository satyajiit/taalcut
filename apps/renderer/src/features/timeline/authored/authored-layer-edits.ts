// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AuthoredEdit, AuthoredInspection } from '@taalcut/core';
import { z } from 'zod';

const properties = z.record(z.string(), z.string().nullable());
function changed(before: Record<string, string>, after: Record<string, string | null>) {
  return Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => before[key] !== after[key])
      .map((key) => [key, after[key] ?? null]),
  );
}

/** Preserve child nodes and source CSS: only properties the user actually changed are written. */
export function authoredLayerEdits(
  element: AuthoredInspection['elements'][number],
  input: { text: string; styles: string; attributes: string; order: number },
): AuthoredEdit[] {
  const edits: AuthoredEdit[] = [];
  const styles = changed(element.styles, properties.parse(JSON.parse(input.styles)));
  const attributes = changed(element.attributes, properties.parse(JSON.parse(input.attributes)));
  if (element.text !== null && element.text !== input.text)
    edits.push({ kind: 'text', target: element.id, text: input.text });
  if (Object.keys(styles).length) edits.push({ kind: 'style', target: element.id, styles });
  for (const [name, value] of Object.entries(attributes))
    edits.push({ kind: 'attribute', target: element.id, name, value });
  if (input.order !== Number(element.styles['z-index'] ?? 0))
    edits.push({ kind: 'order', target: element.id, zIndex: input.order });
  return edits;
}
