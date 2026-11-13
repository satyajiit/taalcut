// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the export's Phase 3 stages learned that QA's Phase 3 checks read (qa/modules `QaFacts`): the framing
 * of each reframed clip, the mix's voice-over-music report, the Content Credentials
 * option and inventory, the Style the brand layer drew, and (EAR1-A2) who hears the render. Each part is absent
 * when that feature isn't in the render, and its checks are skipped.
 */
import {
  RationalTime,
  type AsyncResult,
  type JobId,
  type RenderListening,
  type SequenceItem,
  type SoundListener,
  type VoiceOverMusicReport,
} from '@taalcut/core';
import type { PlannedAudioClip } from '../../plan/types';
import { slotMatchFact } from '../../qa/checks/slot-match/build';
import { stylePacingShots } from '../../qa/checks/style-pacing';
import type { PlannedEffect, QaFacts, SoundListeningFact } from '../../qa/modules';
import { hearingOf } from '../../qa/modules/sound-listening';
import type { ExportInputs } from '../export-inputs';
import type { PlannedFraming } from './framing';
import type { CanvasHeads } from './heads';
import type { Signing } from './signing';

export interface QaFactsInput {
  readonly inputs: ExportInputs;
  readonly framing: PlannedFraming | null;
  /** FRM1-OVL: every clip's heads on the canvas. */
  readonly heads?: CanvasHeads;
  readonly voiceOverMusic: VoiceOverMusicReport | null;
  readonly signing: Signing;
  /** EAR1-A2: the render's listener and the export's job (its analysis runs as the job's child). */
  readonly listener?: SoundListener;
  readonly jobId?: JobId | null;
  /** The finished file: its hearing starts now, beside QA's other passes. */
  readonly file?: string;
  readonly signal?: AbortSignal;
}

/**
 * EAR1-R4: an effect clip as the sound checks read it. A clip that records the source instant that lands on its cut
 * (`syncPoint`, at real speed) names that cut's render frame; `sfx.setHits` records none today (a hit keeps its start,
 * not its cut), so the module falls back to the first cut the clip covers.
 */
function plannedEffect(clip: PlannedAudioClip, item: SequenceItem | undefined, fps: number): PlannedEffect {
  const syncPoint = item?.type === 'clip' && clip.speed === null ? item.syncPoint : null;
  if (!syncPoint) return clip.span;
  const into = RationalTime.toSeconds(syncPoint) - RationalTime.toSeconds(clip.sourceIn);
  return { ...clip.span, anchor: clip.span.start + Math.round(into * fps) };
}

/** EAR1-A2: the sound checks' facts: the timeline's sound effects, and the template reel's sound when it has one. */
export function listeningFact(input: QaFactsInput): QaFacts['listening'] {
  const { inputs, listener } = input;
  if (!listener) return undefined;
  const effectTracks = inputs.timeline.tracks.flatMap((track) =>
    track.kind === 'audio' && track.role === 'sfx' && track.enabled ? [track] : [],
  );
  const trackIds = new Set(effectTracks.map((track) => track.id));
  const items = new Map<string, SequenceItem>(
    effectTracks.flatMap((track) => track.items.map((item) => [item.id, item] as const)),
  );
  const fps = inputs.plan.rate.num / inputs.plan.rate.den;
  const reference = inputs.slotMatch?.template.audio.listening ?? undefined;
  const fact: SoundListeningFact = {
    listener,
    profile: reference ? 'reference' : 'launch',
    ...(reference ? { reference } : {}),
    ...(input.jobId ? { parentJobId: input.jobId } : {}),
    effects: inputs.plan.audio
      .filter((clip) => trackIds.has(clip.track))
      .map((clip) => plannedEffect(clip, items.get(clip.id), fps)),
    transitionCuts: inputs.plan.transitions.map((transition) => ({
      frame: transition.cut,
      to: transition.to,
    })),
  };
  const file = input.file;
  if (!file || inputs.qaPlan.audio.silent) return fact;
  // Its own abort as well as the export's: a hearing no QA run takes is stopped when QA returns (dropPrefetch).
  const dropped = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, dropped.signal]) : dropped.signal;
  let pending: AsyncResult<RenderListening> | undefined = listener.hearRender(
    hearingOf(inputs.qaPlan, fact, file, signal),
  );
  return {
    ...fact,
    prefetched: (asked) => {
      if (asked !== file) return undefined;
      const taken = pending;
      pending = undefined;
      return taken;
    },
    dropPrefetch: () => {
      if (!pending) return;
      pending = undefined;
      dropped.abort();
    },
  };
}

export function qaFacts(input: QaFactsInput): QaFacts {
  const { inputs } = input;
  const style = inputs.styled.style;
  const pacing = inputs.stylePacing;
  const slots = inputs.slotMatch;
  const listening = listeningFact(input);
  return {
    ...(listening ? { listening } : {}),
    ...(input.framing ? { reframe: input.framing.qa } : {}),
    ...(input.heads ? { heads: input.heads } : {}),
    voiceOverMusic: { report: input.voiceOverMusic, settings: inputs.timeline.mix.ducking },
    credentials: input.signing.qa,
    ...(style
      ? {
          brand: {
            style,
            bumpers: inputs.plan.bumpers,
            assetsPresent: new Set(inputs.styled.brandAssets.keys()),
            safe: inputs.preset.safe,
          },
        }
      : {}),
    ...(pacing ? { stylePacing: { band: pacing, shots: stylePacingShots(inputs.plan) } } : {}),
    ...(slots
      ? {
          slotMatch: slotMatchFact({
            timeline: inputs.timeline,
            template: slots.template,
            shots: slots.shots,
            plan: inputs.plan,
            heads: input.heads?.byClip ?? [],
          }),
        }
      : {}),
  };
}
