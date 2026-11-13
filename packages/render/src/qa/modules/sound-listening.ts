// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render heard (EAR1-A2): one `hearRender` per QA run through core's SoundListener (audio's analysis job in
 * the jobs process, as the export's child; this process opens no ONNX session), read by soundOnCuts (the cut
 * sync), soundClean (the audit) and soundCritique (the critique). The export starts the first hearing when the file
 * is finished (qa-facts.ts), so it runs beside the format, picture and level passes. Skipped without a listener or
 * on a render that is silent on purpose. A listening that fails leaves soundOnCuts and soundClean warning that the
 * sound wasn't heard, not failing: the checks depend on another process, and the render's own loudness and silence
 * checks still measure the file. A hearing whose model parts are null (no model, or one that failed: `critique`,
 * `realness`, `model`) still judges the cut sync and the audit, which are signal processing; soundCritique is
 * skipped, and a partial critique (some metrics unscored) is judged on what it scored.
 */
import {
  RationalTime,
  type HearRenderInput,
  type QaCheckId,
  type QaCheckResult,
  type RenderListening,
} from '@taalcut/core';
import { checkResult, skipped } from '../result';
import { soundCleanCheck } from '../checks/sound-clean';
import { soundCritiqueCheck } from '../checks/sound-critique';
import { soundOnCutsCheck } from '../checks/sound-on-cuts';
import type { HeardCut, PlannedEffect, SoundListeningFact } from './facts';
import type { QaCheckModule, QaModuleInput } from './module';

const IDS = ['soundOnCuts', 'soundClean', 'soundCritique'] as const satisfies readonly QaCheckId[];

/** Frames either side of a recorded anchor that still name its cut (a clip starts on the frame at or after it). */
const ANCHOR_FRAMES = 1;

/**
 * EAR1-R4: the cut an effect was placed for: the one its recorded anchor lands on, else the first cut it covers.
 * An effect's anchor (a bank take's apex, a pack sound's peak) is at or after its start, and its tail (an impact's
 * runs 5 s) plays on over later cuts it was never meant for. `cuts` are in order.
 */
function targetOf(effect: PlannedEffect, cuts: readonly HeardCut[]): HeardCut | undefined {
  const { anchor } = effect;
  if (anchor === undefined) return cuts.find((cut) => cut.frame >= effect.start && cut.frame <= effect.end);
  let nearest: HeardCut | undefined;
  for (const cut of cuts) {
    const off = Math.abs(cut.frame - anchor);
    if (off <= ANCHOR_FRAMES && (!nearest || off < Math.abs(nearest.frame - anchor))) nearest = cut;
  }
  return nearest;
}

/**
 * The cuts the listener hears, in order: the plan's hard cuts, and each transition cut an effect was placed for.
 * `planned` indexes the cuts an effect was placed for: only those are judged (soundOnCuts).
 */
export function soundCuts(
  plan: Pick<QaModuleInput['run']['plan'], 'cuts'>,
  fact: Pick<SoundListeningFact, 'effects' | 'transitionCuts'>,
): { readonly cuts: readonly HeardCut[]; readonly planned: ReadonlySet<number> } {
  const hard = new Set<HeardCut>(plan.cuts.map((cut) => ({ frame: cut.frame, to: cut.to })));
  const candidates = [...hard, ...(fact.transitionCuts ?? [])].sort((a, b) => a.frame - b.frame);
  const targets = new Set(fact.effects.flatMap((effect) => targetOf(effect, candidates) ?? []));
  const cuts = candidates.filter((cut) => hard.has(cut) || targets.has(cut));
  const planned = new Set(cuts.flatMap((cut, index) => (targets.has(cut) ? [index] : [])));
  return { cuts, planned };
}

/** What the listener is asked about a render: its cuts (soundCuts), its frame rate, the profile and the export's job. */
export function hearingOf(
  plan: Pick<QaModuleInput['run']['plan'], 'cuts' | 'rateNum' | 'rateDen'>,
  fact: SoundListeningFact,
  file: string,
  signal?: AbortSignal,
): HearRenderInput {
  const rate = { num: plan.rateNum, den: plan.rateDen };
  return {
    file,
    cuts: soundCuts(plan, fact).cuts.map((cut) => RationalTime.of(cut.frame, rate)),
    frameRate: rate,
    profile: fact.profile,
    ...(fact.reference ? { reference: fact.reference } : {}),
    ...(fact.parentJobId ? { parentJobId: fact.parentJobId } : {}),
    ...(signal ? { signal } : {}),
  };
}

function unheard(id: QaCheckId, code: string, durationMs: number): QaCheckResult {
  return checkResult(
    id,
    'warn',
    { findings: [{ target: { kind: 'file', id: code.slice(0, 64) } }] },
    durationMs,
  );
}

export const soundListeningQaModule: QaCheckModule = {
  ids: IDS,
  probeFrames: () => [],
  async run({ run, facts, signal }, wanted) {
    const ids = IDS.filter((id) => wanted.has(id));
    if (ids.length === 0) return [];
    const fact = facts.listening;
    if (!fact || run.plan.audio.silent) return ids.map((id) => skipped(id));
    const fps = run.plan.rateNum / run.plan.rateDen;
    const started = Date.now();
    // A re-run after an auto fix hears the new file, cancelled with the QA run.
    const heard = await (fact.prefetched?.(run.file) ??
      fact.listener.hearRender(hearingOf(run.plan, fact, run.file, signal)));
    const took = Date.now() - started;
    if (!heard.ok) {
      return ids.map((id) =>
        id === 'soundCritique' ? skipped(id, took) : unheard(id, heard.error.code, took),
      );
    }
    const listening: RenderListening = heard.value;
    return ids.map((id) => {
      if (id === 'soundOnCuts') {
        const { cuts, planned } = soundCuts(run.plan, fact);
        return soundOnCutsCheck({ cutSync: listening.cutSync, cuts, planned, durationMs: took });
      }
      if (id === 'soundClean') return soundCleanCheck({ audit: listening.audit, effects: fact.effects, fps });
      return soundCritiqueCheck({ critique: listening.critique, fps });
    });
  },
};
