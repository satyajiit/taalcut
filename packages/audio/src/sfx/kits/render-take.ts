// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One planned kit take as audio (EAR1-D3), with no Python: the bank's own render when it has this take (the four
 * presets' takes are all pre-rendered: same sound, seed, pitch and width), else a plain take of the sound with the
 * knobs applied as signal processing (edits.ts). Either way the take is audited (F6's `auditSound`, the role and
 * the sound's category as context); an edited take that fails is made again from the sound's next take, up to three
 * times, as earshot re-rolls a seed, and the first clean one kept (or the first, with its warnings).
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { auditSound, type SoundAudit } from '../../listen/dsp/audit';
import type { SpectrogramRunner } from '../../listen/dsp/spectrogram-graph';
import { KitInvalid } from '../../listen/errors';
import { decodeAudioFile } from '../../pcm/decode';
import type { TimeStretcher } from '../../stretch/stretcher';
import type { SfxBankItem, SfxBankTake } from '../bank-catalogue';
import type { SfxBank } from '../bank-source';
import { applyEdits, SR, type Channels } from './edits';
import { pitchHz, pitchLabel, semitones } from './pitch';
import type { KitEdits } from './schema';

/** One take a kit renders (earshot kit.plan's row). */
export interface PlannedTake {
  readonly role: string;
  /** The lock's file name ('tick-crisp_2.wav', 'bell_C5.wav'). */
  readonly file: string;
  /** The kit's sound id, earshot's or Taalcut's. */
  readonly sound: string;
  readonly seed: number;
  readonly pitch: string | number | null;
  /** Every knob but pitch. */
  readonly edits: Omit<KitEdits, 'pitch'>;
  readonly maxS: number | null;
  readonly k: number;
  readonly width?: number;
}

export interface TakeAudio {
  /** 48 kHz, the take's own channels, without the bank file's silent pads. */
  readonly channels: Float32Array[];
  readonly item: SfxBankItem;
  /** The bank take it is (`bank`) or was made from (`edited`). */
  readonly take: SfxBankTake;
  readonly source: 'bank' | 'edited';
  readonly seed: number;
  readonly audit: SoundAudit;
}

export interface TakeRenderDeps {
  readonly bank: SfxBank;
  readonly media: MediaContext;
  readonly runner: SpectrogramRunner;
  /** For pitch and reshaping `dur`; a kit that needs neither renders without it. */
  readonly stretcher?: TimeStretcher;
  readonly signal?: AbortSignal;
}

const HIT_ROLES = ['hit', 'land'];
const REROLL = 3;

const hasEdits = (planned: PlannedTake) =>
  Object.values(planned.edits).some((v) => v !== undefined) || (planned.maxS ?? null) !== null;

/** The bank's own render of this planned take, if it has one (the role's audit context preferred). */
export function bankTakeFor(item: SfxBankItem, planned: PlannedTake): SfxBankTake | undefined {
  if (hasEdits(planned)) return undefined;
  const label = planned.pitch === null ? null : pitchLabel(planned.pitch);
  const width = planned.width ?? null;
  const same = item.takes.filter(
    (t) => t.plannedSeed === planned.seed && t.pitch === label && t.width === width,
  );
  const context = HIT_ROLES.includes(planned.role) ? planned.role : null;
  return same.find((t) => t.auditRole === context) ?? same.find((t) => t.auditRole === null) ?? same[0];
}

/** A bank take's samples, decoded at 48 kHz without its pads. */
export async function decodeBankTake(deps: TakeRenderDeps, take: SfxBankTake): AsyncResult<Float32Array[]> {
  const pcm = await decodeAudioFile(deps.bank.pathOf(take), deps.media, {
    sampleRate: SR,
    channels: take.channels,
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  if (!pcm.ok) return pcm;
  const pad = Math.round((deps.bank.catalogue.padMs * SR) / 1000);
  return ok(pcm.value.channels.map((c) => c.slice(pad, pad + take.frames)));
}

const audit = (deps: TakeRenderDeps, item: SfxBankItem, role: string, channels: Channels) =>
  auditSound({ sampleRate: SR, channels }, deps.runner, { category: item.category, role });

/** The plain takes to edit from: the planned seed's first, then the others (earshot re-rolls a seed). */
function bases(item: SfxBankItem, seed: number): SfxBankTake[] {
  const plain = item.takes.filter((t) => t.pitch === null && t.width === null);
  const ordered = [
    ...plain.filter((t) => t.plannedSeed === seed),
    ...plain.filter((t) => t.plannedSeed !== seed),
  ];
  return [...new Map(ordered.map((t) => [t.file, t])).values()];
}

export async function renderTake(deps: TakeRenderDeps, planned: PlannedTake): AsyncResult<TakeAudio> {
  const item = deps.bank.byUpstreamId(planned.sound);
  if (!item) return err(KitInvalid(undefined, { detail: `${planned.role}: unknown sound ${planned.sound}` }));
  const own = bankTakeFor(item, planned);
  if (own) {
    const channels = await decodeBankTake(deps, own);
    if (!channels.ok) return channels;
    const checked = await audit(deps, item, planned.role, channels.value);
    return ok({ channels: channels.value, item, take: own, source: 'bank', seed: own.seed, audit: checked });
  }
  let shift: number | undefined;
  if (planned.pitch !== null) {
    const hz = pitchHz(planned.pitch);
    const knob = item.knobs.pitch;
    if (hz === null || !knob)
      return err(
        KitInvalid(undefined, {
          detail: `${planned.role}: ${item.upstreamId} takes no pitch ${planned.pitch}`,
        }),
      );
    shift = semitones(knob.nativeHz, hz);
  }
  const needsStretch = shift !== undefined || (planned.edits.dur !== undefined && item.knobs.dur !== 'trim');
  if (needsStretch && !deps.stretcher)
    return err(
      KitInvalid(undefined, { detail: `${planned.role}: pitch and reshaping need the time-stretcher` }),
    );
  let first: TakeAudio | undefined;
  for (const base of bases(item, planned.seed).slice(0, REROLL + 1)) {
    const decoded = await decodeBankTake(deps, base);
    if (!decoded.ok) return decoded;
    const edited = await applyEdits(deps.stretcher ?? noStretch, decoded.value, {
      ...(planned.edits.dur !== undefined ? { dur: planned.edits.dur } : {}),
      ...(planned.edits.apex !== undefined ? { apex: planned.edits.apex } : {}),
      ...(shift !== undefined ? { semitones: shift } : {}),
      ...(planned.edits.peak_db !== undefined ? { peakDb: planned.edits.peak_db } : {}),
      ...(planned.edits.weight !== undefined ? { weight: planned.edits.weight } : {}),
      maxS: planned.maxS,
      durMethod: item.knobs.dur,
    });
    if (!edited.ok) return edited;
    const checked = await audit(deps, item, planned.role, edited.value);
    const made: TakeAudio = {
      channels: edited.value,
      item,
      take: base,
      source: 'edited',
      seed: base.seed,
      audit: checked,
    };
    if (checked.ok) return ok(made);
    first ??= made;
  }
  return first
    ? ok(first)
    : err(KitInvalid(undefined, { detail: `${planned.role}: ${item.upstreamId} has no plain take` }));
}

/** Never called: a take that would need stretching is refused above when there is no stretcher. */
const noStretch: TimeStretcher = {
  engine: 'signalsmith',
  stretch: async () => err(KitInvalid(undefined, { detail: 'no time-stretcher' })),
};
