// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The real breakdown system: @taalcut/templates' `runBreakdown` (P2-T4) on
 * each reel, in a scratch folder of its own, then `resolveCuts` with the
 * reel's recorded verdicts (the Analyst's judgements of disputed cuts, P2-T5)
 * or, without any, the rule. The analysers are src/breakdown/analysers.ts:
 * real media and vision steps, stand-ins for the embedding and beat models.
 *
 * `steps` keeps, per reel, the cut lists of each method so the report can
 * give per-step numbers: confirmed by both methods, every proposal (both plus
 * every dispute), and after the verdicts or the rule.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { newId, systemClock } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { resolveCuts, runBreakdown, type BreakdownDraft, type CutVerdict } from '@taalcut/templates';
import { evalBreakdownAnalysers } from '../breakdown/analysers';
import { type BreakdownInput, type BreakdownSystem } from './types';

export const BREAKDOWN_STEPS = ['both', 'proposals', 'resolved'] as const;
export type BreakdownStep = (typeof BREAKDOWN_STEPS)[number];

export interface TemplateBreakdownOptions {
  readonly media: MediaContext;
  /** Relative `mediaPath`s are under this folder (the golden set's). */
  readonly baseDir: string;
  /** Recorded verdicts per reel id; a reel without any is left to the rule. */
  readonly verdicts?: Readonly<Record<string, readonly CutVerdict[]>>;
  /** Scratch for the experiment folders. Default: a temporary folder, removed after each reel. */
  readonly workDir?: string;
}

export interface TemplateBreakdownSystem extends BreakdownSystem {
  /** Per reel id, each step's cut frames (after predictCuts ran on it). */
  readonly steps: ReadonlyMap<string, Readonly<Record<BreakdownStep, number[]>>>;
}

const unique = (frames: readonly number[]) => [...new Set(frames)].sort((a, b) => a - b);

function stepsOf(draft: BreakdownDraft, resolved: readonly number[]): Record<BreakdownStep, number[]> {
  const both = draft.cuts.map((cut) => cut.frame);
  return {
    both: unique(both),
    proposals: unique([...both, ...draft.disputes.map((dispute) => dispute.frame)]),
    resolved: unique(resolved),
  };
}

export function templateBreakdownSystem(options: TemplateBreakdownOptions): TemplateBreakdownSystem {
  const steps = new Map<string, Record<BreakdownStep, number[]>>();
  const analysers = evalBreakdownAnalysers(options.media);
  return {
    steps,
    async predictCuts(input: BreakdownInput): Promise<number[]> {
      if (!input.mediaPath) throw new Error(`Reel ${input.reelId} has no media to break down`);
      const path = isAbsolute(input.mediaPath) ? input.mediaPath : resolve(options.baseDir, input.mediaPath);
      const root = options.workDir ?? mkdtempSync(join(tmpdir(), 'taalcut-evals-bd-'));
      const experimentDir = join(root, input.reelId);
      mkdirSync(experimentDir, { recursive: true });
      try {
        const draft = await runBreakdown(
          {
            breakdownId: newId<'Experiment'>(),
            referencePath: path,
            input: 'file',
            platform: null,
            url: null,
          },
          { ...analysers, experimentDir, clock: systemClock },
          { signal: new AbortController().signal },
        );
        if (!draft.ok) throw new Error(`${input.reelId}: ${draft.error.code} ${draft.error.detail ?? ''}`);
        const { cuts } = resolveCuts(draft.value, options.verdicts?.[input.reelId] ?? []);
        const frames = unique(cuts.map((cut) => cut.frame));
        steps.set(input.reelId, stepsOf(draft.value, frames));
        return frames;
      } finally {
        if (options.workDir === undefined) rmSync(root, { recursive: true, force: true });
      }
    },
  };
}
