// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An AudioMixPlan as FFmpeg filter-graph text (SPEC section 8, P3.9). Each segment becomes a chain that
 * trims its source, plays it at its tempo, makes it exactly its length, fades, gains and delays it to its
 * first sample; the chains are summed without normalising, so gains stay what the plan says. With ducking
 * (P3-V6) the segments are summed per bus (voice, music, effects) first, so the music and effects buses can
 * each take one gain envelope before the buses are summed. Pure text, no FFmpeg run.
 */
import { buildDspFilterSteps } from '@taalcut/media';
import { tempoFragment, atempoChain } from '../plan/speed-filters';
import { MIX_SAMPLE_RATE, type AudioMixPlan, type MixSegment } from './mix-types';

/** What a segment is for: the dry voice the music ducks under, the music bed, sound effects, or clip ambience. */
export type MixBus = 'voice' | 'music' | 'effects' | 'ambience';
export const MIX_BUSES: readonly MixBus[] = ['voice', 'music', 'effects', 'ambience'];

/** A bus's gain envelope as a `volume` expression of the render time `t` (ducking-apply.ts). */
export type BusGains = Partial<Readonly<Record<MixBus, string>>>;

/**
 * Audio frames the gain is evaluated on. `volume` with `eval=frame` holds one gain per frame; FFmpeg's
 * default of about 1024 samples would step a 30 dB duck in 7 dB jumps over an 80 ms attack. 128 samples
 * (2.7 ms) keeps each step well under a decibel.
 */
export const GAIN_FRAME_SAMPLES = 128;

/** The source trim and the tempo: one atempo for a constant speed, the ramp's pieces otherwise. */
function speedSteps(segment: MixSegment, label: string): string[] {
  const pieces = segment.pieces;
  if (!pieces) {
    const consumed = Math.max(1, Math.round(segment.samples * segment.tempo));
    return [
      `atrim=start_sample=${segment.inSample}:end_sample=${segment.inSample + consumed}`,
      'asetpts=PTS-STARTPTS',
      ...atempoChain(segment.tempo).map((factor) => `atempo=${factor}`),
    ];
  }
  const pad = segment.padSamples ?? 0;
  const skip = segment.skipSamples ?? 0;
  const consumed = pieces.reduce((sum, piece) => sum + piece.consumed, 0);
  return [
    `atrim=start_sample=${segment.inSample}:end_sample=${segment.inSample + Math.max(1, consumed - pad)}`,
    'asetpts=PTS-STARTPTS',
    ...(pad > 0 ? [`adelay=delays=${pad}S:all=1`] : []),
    tempoFragment(pieces, `${label}t`),
    ...(skip > 0 ? [`atrim=start_sample=${skip}`, 'asetpts=PTS-STARTPTS'] : []),
  ];
}

/** One segment's filter chain, from its input pad to a stream of exactly `samples` samples at its start. */
export function segmentFilter(segment: MixSegment, input: number, label: string): string {
  const steps = [
    `aresample=${MIX_SAMPLE_RATE}`,
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    'asetpts=PTS-STARTPTS',
    ...speedSteps(segment, label),
    ...(segment.dspChain ? buildDspFilterSteps(segment.dspChain) : []),
    // Pad a short source and cut a long one, so the segment is exactly its length.
    `apad=whole_len=${segment.samples}`,
    `atrim=end_sample=${segment.samples}`,
  ];
  // Equal-power curves: two clips crossfading over a transition or a speech join keep their loudness.
  if (segment.fadeInSamples > 0) steps.push(`afade=t=in:ss=0:ns=${segment.fadeInSamples}:curve=qsin`);
  if (segment.fadeOutSamples > 0)
    steps.push(
      `afade=t=out:ss=${segment.samples - segment.fadeOutSamples}:ns=${segment.fadeOutSamples}:curve=qsin`,
    );
  if (segment.gainDb !== 0) steps.push(`volume=${segment.gainDb}dB`);
  if (segment.startSample > 0) steps.push(`adelay=delays=${segment.startSample}S:all=1`);
  return `[${input}:a:0]${steps.join(',')}[${label}]`;
}

const exactLength = (samples: number) => `apad=whole_len=${samples},atrim=end_sample=${samples}`;

/** Summed pads, or the one pad as it is. */
function sum(pads: readonly string[]): string {
  return pads.length === 1
    ? `${pads[0]}anull`
    : `${pads.join('')}amix=inputs=${pads.length}:normalize=0:duration=longest:dropout_transition=0`;
}

/** The whole graph: each segment, summed without normalising (gains stay what the plan says), exact length. */
export function mixFilterGraph(mix: AudioMixPlan): string {
  const exact = exactLength(mix.totalSamples);
  const chains = mix.segments.map((segment, index) => segmentFilter(segment, index, `s${index}`));
  if (mix.segments.length === 1) return `${chains[0]};[s0]${exact}[mix]`;
  const pads = mix.segments.map((_, index) => `[s${index}]`).join('');
  return `${chains.join(';')};${pads}amix=inputs=${mix.segments.length}:normalize=0:duration=longest:dropout_transition=0,${exact}[mix]`;
}

/**
 * The graph summed per bus, each bus's envelope applied as one `volume` filter with `eval=frame` over the
 * render time (`asetpts=N/SR/TB` makes `t` the sample count over 48 000), then the buses summed. Without
 * gains it sums to the same samples as mixFilterGraph: addition doesn't care how it is grouped.
 */
export function busedFilterGraph(
  mix: AudioMixPlan,
  busOf: (segment: MixSegment) => MixBus,
  gains: BusGains,
): string {
  const exact = exactLength(mix.totalSamples);
  const chains = mix.segments.map((segment, index) => segmentFilter(segment, index, `s${index}`));
  const buses: string[] = [];
  const pads: string[] = [];
  for (const bus of MIX_BUSES) {
    const members = mix.segments.flatMap((segment, index) => (busOf(segment) === bus ? [`[s${index}]`] : []));
    if (members.length === 0) continue;
    const gain = gains[bus];
    const envelope = gain
      ? `,asetpts=N/SR/TB,asetnsamples=n=${GAIN_FRAME_SAMPLES}:p=0,volume='${gain}':eval=frame`
      : '';
    buses.push(`${sum(members)},${exact}${envelope}[b${bus}]`);
    pads.push(`[b${bus}]`);
  }
  if (pads.length === 0) return mixFilterGraph(mix);
  return `${[...chains, ...buses].join(';')};${sum(pads)},${exact}[mix]`;
}
