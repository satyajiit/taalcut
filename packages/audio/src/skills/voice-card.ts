// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Voice director's step card (U-1, core's voiceoverCardSchema): the stored voiceover's lines, voice and
 * quality, what the current takes cost, what a final pass would cost now, and the ducking setting. Built from the
 * stored timeline, so an edit made from the card shows on the next send under the same id.
 */
import {
  err,
  ok,
  parseCard,
  type AssetId,
  type AsyncResult,
  type Card,
  type SkillContext,
  type Timeline,
  type Voiceover,
} from '@taalcut/core';
import type { GenerationPrices } from '../tools/prices';
import { voiceoverQuality } from '../tools/voice-output';

export const VOICE_DIRECTOR_SKILL_ID = 'voice.director';

/**
 * What the voiceover's current takes cost (their files' provenance), when the library can say. Without it the
 * card shows the takes at list price: superseded takes aren't counted either way; the CloudCall log has every call.
 */
export type TakesCost = (assetIds: readonly AssetId[], signal: AbortSignal) => AsyncResult<number>;

const usd = (value: number) => ({ currency: 'USD', micros: Math.round(value * 1_000_000) });

const characters = (voiceover: Voiceover, which: 'draft' | 'final' | 'all') =>
  voiceover.lines
    .filter((line) => which === 'all' || line.quality === which)
    .reduce((sum, line) => sum + line.text.length, 0);

async function spentOn(
  voiceover: Voiceover,
  prices: GenerationPrices,
  cost: TakesCost | undefined,
  signal: AbortSignal,
): AsyncResult<number> {
  if (cost) {
    const assets = voiceover.lines.flatMap((line) => (line.assetId ? [line.assetId] : []));
    return cost(assets, signal);
  }
  return ok(
    characters(voiceover, 'draft') * prices.voicePerCharacter('draft') +
      characters(voiceover, 'final') * prices.voicePerCharacter('final'),
  );
}

export async function voiceoverCard(
  timeline: Timeline,
  deps: { readonly prices: GenerationPrices; readonly cost?: TakesCost },
  ctx: SkillContext,
): AsyncResult<Card | undefined> {
  const voiceover = timeline.voiceover;
  if (!voiceover) return ok(undefined);
  const spent = await spentOn(voiceover, deps.prices, deps.cost, ctx.signal);
  if (!spent.ok) return spent;
  const drafts = characters(voiceover, 'draft');
  const card = parseCard({
    type: 'voiceover',
    id: `step:${ctx.flowId ?? ctx.runId}:${VOICE_DIRECTOR_SKILL_ID}`,
    version: 1,
    runId: ctx.runId,
    projectId: timeline.projectId,
    timelineId: timeline.id,
    voiceover: {
      id: voiceover.id,
      voiceName: voiceover.voiceName,
      own: voiceover.own,
      language: voiceover.language,
      lines: voiceover.lines,
    },
    quality: voiceoverQuality(voiceover.lines),
    spent: usd(spent.value),
    finalizeEstimate: drafts > 0 ? usd(drafts * deps.prices.voicePerCharacter('final')) : null,
    ducking:
      timeline.music.path === 'platformSound'
        ? null
        : { enabled: timeline.mix.ducking.enabled, minMarginLu: null },
  });
  return card.ok ? ok(card.value) : err(card.error);
}
