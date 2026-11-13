// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ: the review's words for a graphic brief's kinds and story roles (core graphic-brief.ts), and an overlay's
 * brief looked up without a value import from core (the kit imports only its types).
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { GraphicBrief, GraphicBriefKind, GraphicStoryRole, Id, Template } from '@taalcut/core';

/** What a graphic is, as the review names it. */
export const GRAPHIC_KIND_WORDS: Readonly<Record<GraphicBriefKind, MessageDescriptor>> = {
  incomingMessage: msg`Their message`,
  outgoingMessage: msg`Your message`,
  typingIndicator: msg`Typing dots`,
  title: msg`Title`,
  caption: msg`Caption`,
  locationTag: msg`Location tag`,
  lowerThird: msg`Lower third`,
  pill: msg`Pill`,
  label: msg`Label`,
  sticker: msg`Sticker`,
  callout: msg`Callout`,
  callToAction: msg`Call to action`,
  other: msg`Other graphic`,
};

/** A graphic's part in the story. */
export const GRAPHIC_ROLE_WORDS: Readonly<Record<GraphicStoryRole, MessageDescriptor>> = {
  question: msg`Question`,
  answer: msg`Answer`,
  setup: msg`Setup`,
  payoff: msg`Payoff`,
  hook: msg`Hook`,
  context: msg`Context`,
  reaction: msg`Reaction`,
  callToAction: msg`Call to action`,
  other: msg`Other part`,
};

/** The kinds and roles in the order the editor's menus list them. */
export const GRAPHIC_KINDS_LISTED = Object.keys(GRAPHIC_KIND_WORDS) as GraphicBriefKind[];
export const GRAPHIC_ROLES_LISTED = Object.keys(GRAPHIC_ROLE_WORDS) as GraphicStoryRole[];

/** An overlay's brief in the template's reading, if it has one. */
export function briefOf(template: Template, overlayId: Id<'TextOverlay'>): GraphicBrief | undefined {
  return template.graphics?.reading?.briefs.find((brief) => brief.overlayId === overlayId);
}
