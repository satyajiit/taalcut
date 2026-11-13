// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ: the briefs, from the measured facts and the model's answers. The pixels are facts and win where they
 * speak: a measured bubble, pill, band or sticker is a graphic whatever the model says (no real graphic is lost), a
 * bubble is a message, read ticks are the creator's own message and the other side someone else's, a message that
 * asks is a question and the next message from the other side its answer. The model reads what the facts can't:
 * whether plain text is footage, what a graphic is for, and its look in words. Without an answer the facts alone
 * make the brief (`source: 'facts'`). The same facts and answers always give the same briefs. Pure.
 */
import type {
  ConversationSpeaker,
  GraphicBrief,
  GraphicBriefKind,
  GraphicPlatform,
  GraphicStoryRole,
  TextOverlay,
} from '@taalcut/core';
import type { GraphicAnswer } from './answer';
import { isColourful, platformOfMessages } from './colour-words';
import type { GraphicFacts } from './facts';

export interface BriefInput {
  readonly overlay: TextOverlay;
  readonly facts: GraphicFacts;
  readonly answer: GraphicAnswer | null;
}

/** Measured shapes that are always graphics: footage never draws them round its words. */
const ALWAYS_GRAPHIC = new Set(['chatBubble', 'pill', 'lowerThird', 'sticker', 'callout', 'cta']);
/** A design read with less confidence than this is not taken as a fact. */
/** A measured design this sure is the overlay's look (FIX-HOOK: also what the Analyst is told it is drawn on). */
export const SURE_DESIGN = 0.5;
const MESSAGES = new Set<GraphicBriefKind>(['incomingMessage', 'outgoingMessage']);

const DESIGN_KIND: Partial<Record<NonNullable<TextOverlay['design']>['kind'], GraphicBriefKind>> = {
  pill: 'pill',
  label: 'label',
  lowerThird: 'lowerThird',
  sticker: 'sticker',
  callout: 'callout',
  cta: 'callToAction',
  kineticTitle: 'title',
};

const WHAT: Record<GraphicBriefKind, string> = {
  incomingMessage: 'an incoming message from someone else',
  outgoingMessage: "a message from the reel's creator",
  typingIndicator: 'a typing indicator',
  title: 'a title',
  caption: 'a caption',
  locationTag: 'a location tag',
  lowerThird: 'a lower third',
  pill: 'a pill-shaped label',
  label: 'a label',
  sticker: 'a sticker',
  callout: 'a callout',
  callToAction: 'a call to action',
  other: 'on-screen text',
};

const sureDesign = (overlay: TextOverlay) =>
  overlay.design && overlay.design.confidence >= SURE_DESIGN ? overlay.design : undefined;
const isBubble = (overlay: TextOverlay) => sureDesign(overlay)?.kind === 'chatBubble';
const asks = (text: string) => /[?？¿]/.test(text);

/**
 * A measured bubble, pill, band or sticker is a graphic whatever was said; otherwise the model's word, and without
 * one the text stage's: text it wasn't sure of (it came and went with its shot) is footage until the review restores
 * it, as made videos already leave it out.
 */
/**
 * What FIX-SIGN settled: its tie-break's answer, else its fused verdict. Unsure, no record, or composited on the look
 * alone leaves it open.
 */
function settledOf(input: BriefInput): 'composited' | 'scene' | null {
  const record = input.facts.record;
  if (record?.asked && record.asked !== 'unsure') return record.asked;
  if (record?.kind === 'composited' && record.lookAlone) return null;
  return record?.kind === 'composited' || record?.kind === 'scene' ? record.kind : null;
}

function isGraphic(input: BriefInput): boolean {
  const design = sureDesign(input.overlay);
  if (design && ALWAYS_GRAPHIC.has(design.kind)) return true;
  // FIX-SIGN's fused evidence decides what it was sure of; the model, only the rest. Composited on the look alone
  // with no answer stays a graphic, as FIX-SIGN kept it.
  const settled = settledOf(input);
  if (settled) return settled === 'composited';
  if (input.facts.record?.kind === 'composited') return input.answer?.graphic ?? true;
  return input.answer?.graphic ?? !input.facts.sceneDoubt;
}

/** Why footage isn't a graphic, when the model gave no reason. */
const FOOTAGE_REASON = {
  said: 'Read as part of the filmed scene.',
  doubted: 'Taalcut wasn’t sure it was added in editing: it came and went with its shot.',
};

/** The model's reason when it said footage; else the record's strongest signals; else the doubt's. */
function footageReason(input: BriefInput): string {
  const answer = input.answer;
  const signals = input.facts.record?.signals ?? [];
  const settled = settledOf(input);
  if (settled === 'scene' && signals.length > 0)
    return `Measured as part of the filmed scene: ${signals.join('; ')}.`;
  if (answer?.graphic === false) return answer.reason ?? FOOTAGE_REASON.said;
  if (signals.length > 0) return `Taalcut wasn’t sure it was added in editing: ${signals.join('; ')}.`;
  return answer ? FOOTAGE_REASON.said : FOOTAGE_REASON.doubted;
}

/** Kinds with no shape of their own round the words. */
const SHAPELESS = new Set<GraphicBriefKind>(['title', 'caption', 'other']);

function baseKind(input: BriefInput): GraphicBriefKind {
  const design = sureDesign(input.overlay);
  const said = input.answer?.kind ?? null;
  if (isBubble(input.overlay)) return said && MESSAGES.has(said) ? said : 'incomingMessage';
  // The pixels measured a pill, a band or a box round the words: a shapeless kind can't be it.
  const shaped = design && design.colors.fill !== null ? DESIGN_KIND[design.kind] : undefined;
  if (shaped && said && SHAPELESS.has(said)) return shaped;
  // A message needs a shape round its words: a bubble the reader saw as a box or a pill still is one.
  if (said && (!MESSAGES.has(said) || input.overlay.design?.colors.fill)) return said;
  return (design && DESIGN_KIND[design.kind]) ?? (isGraphic(input) ? 'title' : 'other');
}

/** The side a message sits on: its tail's, else the half of the frame it is in. */
export function sideOf(overlay: TextOverlay): 'left' | 'right' {
  const tail = overlay.design?.tail ?? 'none';
  if (tail !== 'none') return tail;
  const box = overlay.design?.shape ?? overlay.box;
  return box.x + box.width / 2 < 0.5 ? 'left' : 'right';
}

/**
 * Who sends each message, from the pixels alone so a reel reads the same every time. Read ticks mark the creator's
 * side. Else a bubble with a colour of its own is the creator's and a white or grey one someone else's, as in
 * iMessage, WhatsApp and Instagram: with both sides present, the coloured side when only one is; else the right. One
 * side only: the creator's when it has ticks or a colour. The model's "incoming" or "outgoing" is not counted: a
 * small model calls every bubble outgoing.
 */
export function speakersOf(messages: readonly BriefInput[]): Map<string, ConversationSpeaker> {
  const on = (side: 'left' | 'right') => messages.filter((message) => sideOf(message.overlay) === side);
  const ticks = (side: 'left' | 'right') =>
    on(side).some((message) => message.overlay.design?.receipt === true);
  const coloured = (side: 'left' | 'right') =>
    on(side).length > 0 &&
    on(side).every((message) => {
      const fill = message.overlay.design?.colors.fill;
      return fill !== null && fill !== undefined && isColourful(fill);
    });
  const present = (['left', 'right'] as const).filter((side) => on(side).length > 0);
  let mine: 'left' | 'right' | null;
  if (ticks('left') !== ticks('right')) mine = ticks('left') ? 'left' : 'right';
  else if (present.length === 2)
    mine = coloured('left') !== coloured('right') ? (coloured('left') ? 'left' : 'right') : 'right';
  else {
    const only = present[0];
    mine = only && (ticks(only) || coloured(only)) ? only : null;
  }
  return new Map(
    messages.map(
      (message) => [message.overlay.id, sideOf(message.overlay) === mine ? 'me' : 'them'] as const,
    ),
  );
}

function roleOf(input: BriefInput, kind: GraphicBriefKind, first: boolean): GraphicStoryRole {
  if (input.answer?.role) return input.answer.role;
  if (kind === 'callToAction') return 'callToAction';
  if (kind === 'title') return first ? 'hook' : 'context';
  return 'context';
}

function confidenceOf(input: BriefInput, kind: GraphicBriefKind, graphic: boolean): number {
  if (!input.answer) return Math.min(0.6, input.overlay.design?.confidence ?? 0.4);
  // Whether it is a graphic was the evidence's to say when it settled it: only the kind needs to agree.
  const sayer = settledOf(input) ? graphic : (input.answer.graphic ?? true);
  const agreed = input.answer.kind === kind && sayer === graphic;
  return agreed ? 0.85 : 0.65;
}

/** One brief per overlay read, in the reel's order (the prompt numbers them in that order too). */
export function composeBriefs(inputs: readonly BriefInput[]): GraphicBrief[] {
  const ordered = [...inputs].sort((a, b) => a.facts.start - b.facts.start);
  const graphic = new Map(ordered.map((input) => [input.overlay.id, isGraphic(input)] as const));
  const kinds = new Map(ordered.map((input) => [input.overlay.id, baseKind(input)] as const));
  const messages = ordered.filter(
    (input) => graphic.get(input.overlay.id) && MESSAGES.has(kinds.get(input.overlay.id)!),
  );
  const speakers = speakersOf(messages);
  for (const message of messages)
    kinds.set(
      message.overlay.id,
      speakers.get(message.overlay.id) === 'me' ? 'outgoingMessage' : 'incomingMessage',
    );
  // A message that asks is a question; the next message from the other side answers it.
  const roles = new Map<string, { role: GraphicStoryRole; answers: TextOverlay['id'] | null }>();
  messages.forEach((message, index) => {
    if (!asks(message.overlay.text)) return;
    roles.set(message.overlay.id, { role: 'question', answers: null });
    const reply = messages
      .slice(index + 1)
      .find((later) => speakers.get(later.overlay.id) !== speakers.get(message.overlay.id));
    if (reply && !roles.has(reply.overlay.id))
      roles.set(reply.overlay.id, { role: 'answer', answers: message.overlay.id });
  });
  const platform: GraphicPlatform | null = platformOfMessages(
    messages.map((message) => ({
      fill: message.overlay.design?.colors.fill ?? null,
      receipt: message.overlay.design?.receipt === true,
    })),
  );
  return ordered.map((input, index) => {
    const id = input.overlay.id;
    const isOn = graphic.get(id)!;
    const kind = kinds.get(id)!;
    const answer = input.answer;
    const anchored = roles.get(id);
    const answered = answer?.answers ? ordered[answer.answers - 1]?.overlay.id : undefined;
    const isMessage = MESSAGES.has(kind);
    return {
      overlayId: id,
      graphic: isOn,
      reason: isOn ? null : footageReason(input),
      kind,
      what: answer?.what && answer.kind === kind ? answer.what : WHAT[kind],
      role: anchored?.role ?? roleOf(input, kind, index === 0),
      answers: anchored ? anchored.answers : answered && answered !== id ? answered : null,
      look: {
        words: answer?.look ?? input.facts.look ?? 'plain words on the picture',
        platform: (isMessage ? platform : null) ?? answer?.platform ?? 'neutral',
        shadow: answer?.shadow ?? false,
        avatar: input.overlay.design?.avatar ?? answer?.avatar ?? false,
      },
      motion: { words: input.facts.motion, typingSeconds: input.facts.typingSeconds },
      timing: input.facts.timing,
      people: { words: input.facts.people },
      source: answer ? 'model' : 'facts',
      confidence: confidenceOf(input, kind, isOn),
    };
  });
}
