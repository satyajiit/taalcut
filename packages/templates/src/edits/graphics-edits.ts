// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: a template's compositions and the overlays they draw (`template.setGraphics`), as the template's design or
 * `workspace.promote` leaves them. The reading (DSG1-READ's briefs and graphic system) is never touched; a use whose
 * overlay the template no longer has is dropped, and null removes every design, so no overlay is drawn as a graphic
 * until one is designed. HFW1 retire: DSG1-AUT's components are gone.
 */
import { ok, type GraphicComponents, type Result, type Template } from '@taalcut/core';

export function setGraphics(
  template: Template,
  input: { readonly graphics: GraphicComponents | null },
): Result<Template> {
  const reading = template.graphics?.reading;
  const overlays = new Set(template.text.map((overlay) => overlay.id));
  const compositions = input.graphics?.compositions ?? [];
  const uses = (input.graphics?.uses ?? []).filter((use) => overlays.has(use.overlayId));
  if (compositions.length === 0 && !reading) {
    const { graphics: _, ...rest } = template;
    return ok(rest);
  }
  return ok({
    ...template,
    graphics: {
      uses,
      ...(compositions.length > 0 ? { compositions } : {}),
      ...(reading ? { reading } : {}),
    },
  });
}
