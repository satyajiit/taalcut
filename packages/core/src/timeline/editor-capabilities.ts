// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';

/** Domain-owned action declarations. Desktop supplies availability from its registered tools. */
export const editorCapabilitySchema = z.object({
  id: z.string(),
  commands: z.array(z.string()),
  tools: z.array(z.string()),
  access: z.enum(['ai', 'person']),
  reason: z.string().optional(),
  available: z.boolean().optional(),
});
export type EditorCapability = z.output<typeof editorCapabilitySchema>;

export function commandCapabilities(names: readonly string[]): EditorCapability[] {
  return names.map((name) => ({ id: name, commands: [name], tools: [name], access: 'ai' }));
}
export function queryCapabilities(names: readonly string[]): EditorCapability[] {
  return names.map((name) => ({ id: name, commands: [], tools: [name], access: 'ai' }));
}
export function availableEditorCapabilities(
  domains: readonly (readonly EditorCapability[])[],
  registered: (name: string) => boolean,
): EditorCapability[] {
  return domains.flat().map((entry) => {
    const available = entry.access === 'person' || entry.tools.every(registered);
    return { ...entry, available, ...(!available ? { reason: 'editor.capability_unavailable' } : {}) };
  });
}
export function editorCapabilityTools(entries: readonly EditorCapability[]): string[] {
  return [
    ...new Set(
      entries
        .filter((entry) => entry.access === 'ai' && entry.available !== false)
        .flatMap((entry) => entry.tools),
    ),
  ];
}
