// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-K2: `sfx.searchSounds`' result card (core's `soundResults`): the sounds as found, best first, each named the
 * way its source names it, with a fitted bank sound's credit read from the bank. A row the card can't carry (a
 * library sound whose asset id isn't one) is left off the card, never the output; an output stored as an artifact
 * gets no card.
 */
import { isId, soundResultSchema, type CardOf, type SoundResult, type ToolCardContext } from '@taalcut/core';

/** The search's sounds as `sfx.searchSounds` returns them (its output's `sounds`). */
export interface FoundSound {
  readonly source: 'bank' | 'pack' | 'library';
  readonly soundId?: string | undefined;
  readonly packItemId?: string | undefined;
  readonly assetId?: string | undefined;
  readonly title: string;
  readonly family: SoundResult['family'];
  readonly licence?: SoundResult['licence'];
  readonly z: number;
  readonly verdict: SoundResult['verdict'];
  readonly borderline: boolean;
}

const TITLE_MAX = 120;
const CREDIT_MAX = 300;
const Z_LIMIT = 100;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function cardSound(sound: FoundSound, credit: string | undefined): SoundResult | undefined {
  const row = {
    source: sound.source,
    ...(sound.source === 'bank' && sound.soundId ? { soundId: sound.soundId } : {}),
    ...(sound.source === 'pack' && sound.packItemId ? { packItemId: sound.packItemId } : {}),
    ...(sound.source === 'library' && isId(sound.assetId) ? { assetId: sound.assetId } : {}),
    title: clip(sound.title, TITLE_MAX),
    family: sound.family,
    verdict: sound.verdict,
    ...(sound.borderline ? { borderline: true } : {}),
    z: Math.max(-Z_LIMIT, Math.min(Z_LIMIT, sound.z)),
    ...(sound.source !== 'library' && sound.licence ? { licence: sound.licence } : {}),
    ...(sound.source === 'bank' && credit ? { credit: clip(credit, CREDIT_MAX) } : {}),
  };
  const parsed = soundResultSchema.safeParse(row);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The card for one search. `creditOf` gives a bank sound's credit line (a fitted sound's recording), or undefined
 * for a code-made one or when the bank can't be read.
 */
export function searchSoundsCard(
  output: { readonly query: string; readonly sounds: readonly FoundSound[] },
  ctx: Pick<ToolCardContext, 'runId' | 'toolCallId'>,
  creditOf: (soundId: string) => string | undefined = () => undefined,
): CardOf<'soundResults'> {
  const sounds = output.sounds
    .map((sound) => cardSound(sound, sound.soundId ? creditOf(sound.soundId) : undefined))
    .filter((sound): sound is SoundResult => sound !== undefined);
  return {
    type: 'soundResults',
    id: `sound-results:${ctx.toolCallId}`,
    version: 1,
    runId: ctx.runId,
    query: output.query,
    sounds,
  };
}
