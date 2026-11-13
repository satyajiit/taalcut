// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ, the review's edits of a reel's graphics as pure functions: "Not a graphic" and its restore
 * (`template.graphic.set`), and a brief's words and kinds as the person writes them (`template.graphic.edit`). Both
 * act on `graphics.reading.briefs` and make the brief the person's; aut's components and uses stay as they are.
 * The measured facts (the overlay's design, its timing) never change here.
 */
import {
  err,
  ok,
  TemplateOverlayNotFound,
  type GraphicBrief,
  type GraphicBriefPatch,
  type Result,
  type Template,
  type TextOverlayId,
} from '@taalcut/core';

function withBrief(
  template: Template,
  overlayId: TextOverlayId,
  change: (brief: GraphicBrief) => GraphicBrief,
): Result<Template> {
  const reading = template.graphics?.reading;
  const brief = reading?.briefs.find((item) => item.overlayId === overlayId);
  if (!reading || !brief || !template.text.some((item) => item.id === overlayId))
    return err(TemplateOverlayNotFound());
  return ok({
    ...template,
    graphics: {
      ...template.graphics!,
      reading: {
        ...reading,
        briefs: reading.briefs.map((item) =>
          item.overlayId === overlayId ? { ...change(item), source: 'person' } : item,
        ),
      },
    },
  });
}

/**
 * Whether an overlay is a graphic. Not one: made videos leave it out and the review shows it as removed; a graphic
 * again: its reason goes, and the text stage's "maybe scene" question is answered by the person too.
 */
export function setGraphic(
  template: Template,
  input: { readonly overlayId: TextOverlayId; readonly graphic: boolean },
): Result<Template> {
  const changed = withBrief(template, input.overlayId, (brief) => ({
    ...brief,
    graphic: input.graphic,
    reason: input.graphic ? null : brief.reason,
  }));
  if (!changed.ok) return changed;
  return ok({
    ...changed.value,
    text: changed.value.text.map((item) => {
      if (item.id !== input.overlayId || !item.doubts) return item;
      const { doubts, ...rest } = item;
      const kept = doubts.filter((doubt) => doubt.reason !== 'textMaybeScene');
      return kept.length > 0 ? { ...rest, doubts: kept } : rest;
    }),
  });
}

/** A brief's words and kinds as the person writes them; the measured facts stay. */
export function editGraphic(
  template: Template,
  input: { readonly overlayId: TextOverlayId; readonly brief: GraphicBriefPatch },
): Result<Template> {
  const patch = input.brief;
  return withBrief(template, input.overlayId, (brief) => ({
    ...brief,
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.what !== undefined ? { what: patch.what } : {}),
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.look !== undefined ? { look: { ...brief.look, words: patch.look } } : {}),
    ...(patch.motion !== undefined ? { motion: { ...brief.motion, words: patch.motion } } : {}),
    ...(patch.timing !== undefined ? { timing: { ...brief.timing, words: patch.timing } } : {}),
    ...(patch.people !== undefined ? { people: { words: patch.people } } : {}),
  }));
}

/**
 * The template's graphics without what named overlays it no longer has ("Not text" removed them): their briefs,
 * their places in the conversation, answers to them, and the uses that drew them.
 */
export function withoutGoneOverlays(template: Template): Template {
  const graphics = template.graphics;
  if (!graphics) return template;
  const ids = new Set<string>(template.text.map((item) => item.id));
  const reading = graphics.reading;
  return {
    ...template,
    graphics: {
      ...graphics,
      uses: graphics.uses.filter((use) => ids.has(use.overlayId)),
      ...(reading
        ? {
            reading: {
              ...reading,
              briefs: reading.briefs
                .filter((brief) => ids.has(brief.overlayId))
                .map((brief) =>
                  brief.answers && !ids.has(brief.answers) ? { ...brief, answers: null } : brief,
                ),
              system: {
                ...reading.system,
                conversation: reading.system.conversation.filter((message) => ids.has(message.overlayId)),
              },
            },
          }
        : {}),
    },
  };
}
