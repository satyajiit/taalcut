// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ: the template's graphic system, what its graphics share: the measured tokens (fills, type colours,
 * corners, weight), the conversation in the reel's order with each message's side and sender, and how messages stack
 * when more than one is on screen. All from the briefs and the measured designs, so it is the same every run. Pure.
 */
import type { GraphicBrief, GraphicPlatform, GraphicSystem, TextOverlay } from '@taalcut/core';
import { sideOf } from './compose';

const MESSAGES = new Set(['incomingMessage', 'outgoingMessage']);

/** The values, most used first (ties in first-seen order), at most `max`. */
function byUse(values: readonly string[], max: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([value]) => value);
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)]!;
};

function stackOf(messages: readonly TextOverlay[]): GraphicSystem['stack'] {
  const end = (overlay: TextOverlay) => overlay.start.value + overlay.duration.value;
  for (let index = 1; index < messages.length; index++) {
    const later = messages[index]!;
    const earlier = messages
      .slice(0, index)
      .reverse()
      .find((before) => end(before) > later.start.value);
    if (!earlier) continue;
    const a = earlier.design?.shape ?? earlier.box;
    const b = later.design?.shape ?? later.box;
    const down = b.y >= a.y;
    const gap = down ? b.y - (a.y + a.height) : a.y - (b.y + b.height);
    return { direction: down ? 'down' : 'up', gap: Math.round(Math.min(1, Math.max(0, gap)) * 1000) / 1000 };
  }
  return null;
}

const PLATFORM_WORDS: Record<GraphicPlatform, string> = {
  imessage: 'iMessage-like',
  whatsapp: 'WhatsApp-like',
  instagram: 'Instagram-like',
  neutral: 'plain',
};

function systemWords(
  conversation: GraphicSystem['conversation'],
  stack: GraphicSystem['stack'],
  platform: GraphicPlatform,
  others: number,
): string {
  const parts: string[] = [];
  if (conversation.length > 0) {
    const sides = conversation
      .map(
        (message) => `${message.speaker === 'me' ? "the creator's" : 'their'} message on the ${message.side}`,
      )
      .join(', then ');
    parts.push(`A ${PLATFORM_WORDS[platform]} thread of ${conversation.length}: ${sides}`);
    if (stack)
      parts.push(
        stack.direction === 'down'
          ? 'each new message below the last'
          : 'each new message pushes the others up',
      );
  }
  if (others > 0) parts.push(`${others} other graphic${others === 1 ? '' : 's'} in the same look`);
  return parts.length > 0 ? `${parts.join('; ')}.` : 'No graphics.';
}

/** The system the briefs' graphics share; `text` is the template's (or draft's) overlays. */
export function graphicSystem(briefs: readonly GraphicBrief[], text: readonly TextOverlay[]): GraphicSystem {
  const byId = new Map(text.map((overlay) => [overlay.id, overlay] as const));
  const shown = briefs.filter((brief) => brief.graphic && byId.has(brief.overlayId));
  const designs = shown.flatMap((brief) => byId.get(brief.overlayId)!.design ?? []);
  const messages = shown
    .filter((brief) => MESSAGES.has(brief.kind))
    .map((brief) => ({ brief, overlay: byId.get(brief.overlayId)! }))
    .sort((a, b) => a.overlay.start.value - b.overlay.start.value);
  const conversation = messages.map(({ brief, overlay }) => ({
    overlayId: brief.overlayId,
    side: sideOf(overlay),
    speaker: brief.kind === 'outgoingMessage' ? ('me' as const) : ('them' as const),
  }));
  const platform = (byUse(
    (messages.length > 0 ? messages.map(({ brief }) => brief) : shown).map((brief) => brief.look.platform),
    1,
  )[0] ?? 'neutral') as GraphicPlatform;
  const shapes = designs.filter((design) => design.colors.fill !== null);
  const radius = median(shapes.map((design) => design.cornerRadius));
  const weight = median(designs.map((design) => design.font.weight));
  const stack = stackOf(messages.map(({ overlay }) => overlay));
  return {
    tokens: {
      platform,
      fills: byUse(
        shapes.map((design) => design.colors.fill!),
        8,
      ),
      text: byUse(
        designs.map((design) => design.colors.text),
        8,
      ),
      cornerRadius: radius,
      font: weight === null ? null : { class: 'sans', weight: Math.round(weight / 100) * 100 },
    },
    conversation,
    stack,
    words: systemWords(conversation, stack, platform, shown.length - messages.length),
  };
}
