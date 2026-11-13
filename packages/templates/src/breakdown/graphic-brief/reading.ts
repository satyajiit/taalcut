// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ, when the template is made: the reading of its graphics (`Template.graphics.reading`) from the model's
 * saved answers, the built template's own facts (its final cuts, its people) and the draft's text records
 * (FIX-SIGN). The reading answers the text stage's "maybe scene" doubt on each overlay it briefs: footage is removed
 * from made videos by its brief (the review shows it as removed and can restore it), and a graphic is kept. Pure.
 */
import type { GraphicReading, Template } from '@taalcut/core';
import type { BreakdownDraft } from '../draft';
import { composeBriefs } from './compose';
import { graphicFacts, reelOfTemplate } from './facts';
import { GRAPHIC_BRIEF_PROMPT } from './prompt';
import type { GraphicsFile } from './read';
import { graphicSystem } from './system';

/** The reading of the template's overlays that had a sheet; null when none had. */
export function graphicReading(
  template: Template,
  draft: Pick<BreakdownDraft, 'graphicSheets' | 'textRegions'>,
  file: GraphicsFile | null,
): GraphicReading | null {
  const sheets = new Map((draft.graphicSheets ?? []).map((sheet) => [sheet.overlayId, sheet] as const));
  const reel = { ...reelOfTemplate(template), textRegions: draft.textRegions };
  const inputs = template.text
    .filter((overlay) => sheets.has(overlay.id))
    .map((overlay) => ({
      overlay,
      facts: graphicFacts(reel, overlay, sheets.get(overlay.id)!.lead),
      answer: file?.answers[overlay.id] ?? null,
    }));
  if (inputs.length === 0) return null;
  const briefs = composeBriefs(inputs);
  const answered = inputs.some((input) => input.answer !== null);
  return {
    version: 1,
    prompt: GRAPHIC_BRIEF_PROMPT,
    model: answered ? (file?.model ?? null) : null,
    briefs,
    system: graphicSystem(briefs, template.text),
  };
}

/**
 * The template with its reading, beside any compositions it has. The reading answers the "maybe scene" doubt of every
 * overlay it briefs, so the doubt goes: footage leaves made videos by its brief (the review can restore it), and a
 * graphic stays in them, as the template's design and assembly both read it.
 */
export function withGraphicReading(template: Template, reading: GraphicReading | null): Template {
  if (!reading) return template;
  const briefed = new Set(reading.briefs.map((brief) => brief.overlayId));
  return {
    ...template,
    text: template.text.map((overlay) => {
      if (!briefed.has(overlay.id) || !overlay.doubts) return overlay;
      const doubts = overlay.doubts.filter((doubt) => doubt.reason !== 'textMaybeScene');
      const { doubts: _, ...rest } = overlay;
      return doubts.length > 0 ? { ...rest, doubts } : rest;
    }),
    graphics: {
      uses: template.graphics?.uses ?? [],
      ...(template.graphics?.compositions ? { compositions: template.graphics.compositions } : {}),
      reading,
    },
  };
}
