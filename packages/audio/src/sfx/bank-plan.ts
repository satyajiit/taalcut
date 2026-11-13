// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `sfx.addHits` from the SFX bank (EAR1-D2, D3): the planner's cut rules, spacing and levels over bank takes instead
 * of the v1 pack, each take's anchor on its cut (a sound's apex; a kit role's onset, apex or end, less its offset),
 * the takes it used added to the library and the plan returned as hit records naming the bank sound and the role.
 * Asked-for sounds (`soundIds`) take their families' cuts; a kit (a preset's name or a kit file) serves the rest
 * through its roles (kits/picks.ts). Nothing here runs unless the caller asked for bank sounds or a kit, so a
 * version 1 request never reaches it.
 */
import {
  err,
  ok,
  type AsyncResult,
  type GeneratedAssetSink,
  type SfxCategory,
  type SfxHit,
  type Timeline,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { SpectrogramRunner } from '../listen/dsp/spectrogram-graph';
import { KitInvalid } from '../listen/errors';
import type { TimeStretcher } from '../stretch/stretcher';
import { timelineMs } from '../timeline/span';
import { bankHitRecords, importBankTakes, soundPicks, type BankPick } from './bank-hits';
import type { SfxBankSource } from './bank-source';
import { timelineCuts } from './cuts';
import { planHits, type HitDensity, type HitStyle, type Span } from './hit-plan';
import { kitPicks } from './kits/picks';
import { KIT_PRESETS, kitPreset, type KitPreset } from './kits/presets';
import { parseKit } from './kits/schema';

export interface BankHitsDeps {
  readonly bank: SfxBankSource;
  readonly sink: GeneratedAssetSink;
  readonly media: MediaContext;
  /** One per process, made on first use (kit takes with knobs are audited). */
  readonly runner: () => SpectrogramRunner;
  readonly stretcher?: TimeStretcher;
}

export interface BankHitsRequest {
  readonly timeline: Timeline;
  /** Spoken voiceover, timeline ms (hits-service's voiceSpeech). */
  readonly speech: readonly Span[];
  readonly density?: HitDensity;
  readonly style?: HitStyle;
  readonly soundIds?: readonly string[];
  /** A preset's name or a kit file (schema 1). */
  readonly kit?: KitPreset | unknown;
  /** Which kit role serves a cut category (default kits/picks.ts CATEGORY_ROLES). */
  readonly roles?: Partial<Record<SfxCategory, string>>;
  readonly signal?: AbortSignal;
}

/** The planner over bank picks; the takes used go to the library. */
export async function planBankHits(input: {
  readonly timeline: Timeline;
  readonly picks: readonly BankPick[];
  readonly sink: GeneratedAssetSink;
  readonly speech: readonly Span[];
  readonly density?: HitDensity;
  readonly style?: HitStyle;
  readonly signal?: AbortSignal;
}): AsyncResult<SfxHit[]> {
  const byId = new Map(input.picks.map((pick) => [pick.sound.id, pick]));
  const planned = planHits({
    cuts: timelineCuts(input.timeline),
    items: input.picks.map((pick) => pick.sound),
    timelineMs: timelineMs(input.timeline),
    speech: input.speech,
    ...(input.density ? { density: input.density } : {}),
    ...(input.style ? { style: input.style } : {}),
  });
  const assets = await importBankTakes(input.sink, planned, byId, input.signal);
  if (!assets.ok) return assets;
  return ok(bankHitRecords(planned, byId, assets.value));
}

const isPreset = (kit: unknown): kit is KitPreset =>
  typeof kit === 'string' && (KIT_PRESETS as readonly string[]).includes(kit);

export async function bankHits(deps: BankHitsDeps, request: BankHitsRequest): AsyncResult<SfxHit[]> {
  const bank = await deps.bank.load();
  if (!bank.ok) return bank;
  const named = soundPicks(bank.value, request.soundIds ?? []);
  if (!named.ok) return named;
  let picks = named.value;
  if (request.kit !== undefined) {
    if (typeof request.kit === 'string' && !isPreset(request.kit))
      return err(KitInvalid(undefined, { detail: `no preset ${request.kit} (${KIT_PRESETS.join(', ')})` }));
    const kit = parseKit(isPreset(request.kit) ? kitPreset(request.kit) : request.kit, bank.value);
    if (!kit.ok) return kit;
    const fromKit = await kitPicks(
      {
        bank: bank.value,
        media: deps.media,
        runner: deps.runner(),
        ...(deps.stretcher ? { stretcher: deps.stretcher } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      },
      kit.value,
      request.roles ?? {},
    );
    if (!fromKit.ok) return fromKit;
    // Asked-for sounds keep their families' cuts; the kit serves the others.
    const taken = new Set(picks.map((pick) => pick.sound.category));
    picks = [...picks, ...fromKit.value.filter((pick) => !taken.has(pick.sound.category))];
  }
  return planBankHits({
    timeline: request.timeline,
    picks,
    sink: deps.sink,
    speech: request.speech,
    ...(request.density ? { density: request.density } : {}),
    ...(request.style ? { style: request.style } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
  });
}
