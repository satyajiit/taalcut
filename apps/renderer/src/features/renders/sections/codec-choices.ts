// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The video format choices of an export preset (LNX1-AV1): the codecs a preset offers, each with whether this
 * machine can make it (the export options' `codecs`, render's answer from media's hardware encoders).
 */
import { FrameRate, type ExportOptions, type ExportVideoCodec } from '@taalcut/core';

type PresetEntry = ExportOptions['presets'][number];
export type CodecChoice = NonNullable<PresetEntry['codecs']>[number];

/** The preset's codecs on this machine, its default first: the options' notes, or all of them usable. */
export function codecChoices(entry: PresetEntry): readonly CodecChoice[] {
  return (
    entry.codecs ??
    (entry.preset.video.codecs ?? [entry.preset.video.codec]).map((codec) => ({ codec, available: true }))
  );
}

/** The codec kept when the preset changes: the chosen one while the new preset offers it and this machine makes it. */
export function keptCodec(
  entry: PresetEntry | undefined,
  codec: ExportVideoCodec | undefined,
): ExportVideoCodec | undefined {
  return entry && codecChoices(entry).some((choice) => choice.codec === codec && choice.available)
    ? codec
    : undefined;
}

/** The frame rates an export preset can make from `sourceRate`: the timeline's rate first, then exact multiples (such as 60 fps). */
export function rateChoices(entry: PresetEntry, sourceRate: FrameRate): readonly FrameRate[] {
  const compatible = entry.preset.rates.filter(
    (rate) =>
      rate.num * sourceRate.den >= sourceRate.num * rate.den &&
      (BigInt(rate.num) * BigInt(sourceRate.den)) % (BigInt(rate.den) * BigInt(sourceRate.num)) === 0n,
  );
  if (compatible.length === 0) return [sourceRate];
  return [...compatible].sort((a, b) => a.num / a.den - b.num / b.den);
}

export function rateKey(rate: FrameRate): string {
  return `${rate.num}/${rate.den}`;
}

export function keptRate(
  entry: PresetEntry | undefined,
  sourceRate: FrameRate,
  rate: FrameRate | undefined,
): FrameRate | undefined {
  if (!entry || !rate || FrameRate.equals(rate, sourceRate)) return undefined;
  return rateChoices(entry, sourceRate).some((candidate) => FrameRate.equals(candidate, rate))
    ? rate
    : undefined;
}
