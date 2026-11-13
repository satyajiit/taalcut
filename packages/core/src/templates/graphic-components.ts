// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A template's graphics (DSG1-READ, HFW1): the compositions the AI designed for the reel's overlays, which overlay
 * each draws with what values, and the breakdown's reading of the reel's graphics (graphic-brief.ts). A made graphic
 * item names the composition it draws with (timeline/graphics.ts), and the timeline keeps its own copies. HFW1
 * retire: DSG1's authored components (`taalcut.graphic/1`, their validation and the kit kind they stood in for) are
 * gone.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { graphicReadingSchema } from './graphic-brief';
import { graphicParamValuesSchema } from './graphic-params';
import { graphicCompositionSchema, type GraphicComposition } from '../workspace/composition';

export * from './graphic-params';
export * from './graphic-provenance';

/** Which composition draws a template overlay, and the values that overlay gives it (its side, its ticks, its words). */
export const graphicComponentUseSchema = z.object({
  overlayId: idSchema<'TextOverlay'>(),
  /** A composition the template holds. */
  compositionId: idSchema<'GraphicComposition'>(),
  params: graphicParamValuesSchema.optional(),
});
export type GraphicComponentUse = z.output<typeof graphicComponentUseSchema>;

/** The most compositions a template holds (HFW1), one per overlay role. */
export const MAX_TEMPLATE_COMPOSITIONS = 24;

const componentsShape = {
  uses: z.array(graphicComponentUseSchema).max(500).default([]),
  /** HFW1: the compositions the AI designed for the reel's overlays (ids unique). Absent before HFW1. */
  compositions: z.array(graphicCompositionSchema).max(MAX_TEMPLATE_COMPOSITIONS).optional(),
};
type ComponentsPart = {
  uses: readonly GraphicComponentUse[];
  compositions?: readonly GraphicComposition[] | undefined;
};

/** Composition ids unique; every use names a held composition; each overlay once. */
function checkComponents(graphics: ComponentsPart, context: z.RefinementCtx): void {
  const compositions = new Set<string>();
  (graphics.compositions ?? []).forEach((entry, index) => {
    if (compositions.has(entry.id))
      context.addIssue({
        code: 'custom',
        path: ['compositions', index, 'id'],
        message: 'Repeated composition',
      });
    compositions.add(entry.id);
  });
  const used = new Set<string>();
  graphics.uses.forEach((use, index) => {
    const issue = (field: string, message: string) =>
      context.addIssue({ code: 'custom', path: ['uses', index, field], message });
    if (!compositions.has(use.compositionId)) issue('compositionId', 'No such composition');
    if (used.has(use.overlayId)) issue('overlayId', 'Overlay used twice');
    used.add(use.overlayId);
  });
}

/** `template.setGraphics`'s graphics: the compositions and the overlays they draw, never the reading. */
export const graphicComponentsSchema = z.object(componentsShape).superRefine(checkComponents);
export type GraphicComponents = z.output<typeof graphicComponentsSchema>;

/**
 * A template's graphics: its compositions and the overlays they draw, and the breakdown's reading of the reel's
 * graphics (a brief per overlay and the graphic system, graphic-brief.ts). Uses default to none, so a reading can
 * come before anything is designed. Every use names a composition it holds; each overlay has at most one brief.
 */
export const templateGraphicsSchema = z
  .object({ ...componentsShape, reading: graphicReadingSchema.optional() })
  .superRefine((graphics, context) => {
    checkComponents(graphics, context);
    const briefed = new Set<string>();
    graphics.reading?.briefs.forEach((brief, index) => {
      if (briefed.has(brief.overlayId))
        context.addIssue({
          code: 'custom',
          path: ['reading', 'briefs', index, 'overlayId'],
          message: 'Overlay briefed twice',
        });
      briefed.add(brief.overlayId);
    });
  });
export type TemplateGraphics = z.output<typeof templateGraphicsSchema>;
