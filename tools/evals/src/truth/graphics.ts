// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ: a template's graphic reading (`graphics.reading`) scored against a reel's truth file: each true overlay
 * found as a graphic (not lost as footage), with the right kind, part in the story and sender where the truth gives
 * them; the conversation in the truth's order; and the scene text the truth names (a station sign) never a graphic.
 * Counts and truth indexes only, never the reel's words. Pure.
 */
import { isNotGraphic, type Template } from '@taalcut/core';
import type { Truth } from './schema';

type Overlay = Template['text'][number];

export interface GraphicsScore {
  /** Which model wrote the briefs (null: the facts alone). */
  readonly model: { readonly provider: string; readonly model: string; readonly local: boolean } | null;
  readonly briefs: number;
  /** True overlays briefed as graphics, of those briefed. */
  readonly found: number;
  /** Truth indexes of true overlays the reading calls footage: lost from made videos. */
  readonly lost: number[];
  readonly kinds: { readonly right: number; readonly scored: number; readonly wrong: number[] };
  readonly roles: { readonly right: number; readonly scored: number; readonly wrong: number[] };
  readonly speakers: { readonly right: number; readonly scored: number; readonly wrong: number[] };
  /** The truth's messages, in time order, are the reading's conversation's order. */
  readonly conversationOrder: boolean | null;
  /** Readings of the truth's scene text (a station sign) briefed as graphics: never right. */
  readonly sceneAsGraphic: number;
  /** Readings of the truth's scene text the reading removed. */
  readonly sceneRemoved: number;
}

export function scoreGraphics(
  template: Template,
  truth: Truth,
  matchOf: (overlay: Overlay) => number,
  matches: (overlay: Overlay, text: string) => boolean,
): GraphicsScore | null {
  const reading = template.graphics?.reading;
  if (!reading) return null;
  const briefOf = new Map(reading.briefs.map((brief) => [brief.overlayId as string, brief] as const));
  const lost: number[] = [];
  let found = 0;
  const kinds = { right: 0, scored: 0, wrong: [] as number[] };
  const roles = { right: 0, scored: 0, wrong: [] as number[] };
  const speakers = { right: 0, scored: 0, wrong: [] as number[] };
  const messages: { index: number; overlayId: string }[] = [];
  const conversation = reading.system.conversation;
  truth.overlays.forEach((real, index) => {
    const overlay = template.text.find((item) => matchOf(item) === index && briefOf.has(item.id));
    if (!overlay) return;
    const brief = briefOf.get(overlay.id)!;
    if (!brief.graphic) {
      lost.push(index);
      return;
    }
    found += 1;
    if (real.kinds) {
      kinds.scored += 1;
      if (real.kinds.includes(brief.kind)) kinds.right += 1;
      else kinds.wrong.push(index);
    }
    if (real.role) {
      roles.scored += 1;
      if (brief.role === real.role) roles.right += 1;
      else roles.wrong.push(index);
    }
    if (real.speaker) {
      speakers.scored += 1;
      const said = conversation.find((message) => message.overlayId === overlay.id)?.speaker;
      if (said === real.speaker) speakers.right += 1;
      else speakers.wrong.push(index);
      messages.push({ index, overlayId: overlay.id });
    }
  });
  const order = conversation
    .map((message) => messages.find((item) => item.overlayId === message.overlayId)?.index)
    .filter((index): index is number => index !== undefined);
  const truthOrder = messages
    .map((item) => item.index)
    .sort((a, b) => truth.overlays[a]!.startFrame - truth.overlays[b]!.startFrame);
  const scene = template.text.filter((overlay) =>
    truth.sceneText.some((item) => matches(overlay, item.text)),
  );
  return {
    model: reading.model,
    briefs: reading.briefs.length,
    found,
    lost,
    kinds,
    roles,
    speakers,
    conversationOrder: messages.length < 2 ? null : order.join() === truthOrder.join(),
    sceneAsGraphic: scene.filter((overlay) => briefOf.get(overlay.id)?.graphic === true).length,
    sceneRemoved: scene.filter((overlay) => isNotGraphic(template.graphics, overlay.id)).length,
  };
}
