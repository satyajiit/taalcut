// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `eval:design` over the 24 made-up requests (cases.ts), case by case: each gets a fresh made-up video and world,
 * the live Designer (else the stand-in), the judge on what it placed, a line of what it did; then the report,
 * design.json, design.md and the contact sheet in `out`. Everything said or written goes through `scrub` first, so a
 * plan's token never reaches a line or a file.
 */
import type { ArtifactStore } from '@taalcut/core';
import type { DesignerModel } from '@taalcut/render';
import { DESIGN_VIDEO, designCases } from './cases';
import { realFrames, standInFrames, type RealFrames } from './frames';
import { judgeStills, type JudgeAsk } from './judge';
import {
  designMarkdown,
  designReport,
  writeContactSheet,
  writeDesignReport,
  type DesignReport,
  type JudgedCase,
} from './report';
import { runDesignCase, type CaseOutcome } from './run';
import { standInDesigner } from './stand-in';
import { madeUpVideo } from './video';
import { designWorld } from './world';

export interface DesignModeOptions {
  readonly root: string;
  readonly out: string;
  readonly cases: readonly string[];
  readonly frames: 'real' | 'stand-in';
  /** The live Designer; null runs the stand-in. */
  readonly live: DesignerModel | null;
  readonly judge: JudgeAsk | null;
  /** The run's label, asked at the end (a live model's malformed calls are counted as it runs). */
  readonly label: () => string;
  readonly scrub?: (text: string) => string;
  readonly log?: (line: string) => void;
}

/** A value with every token scrubbed out of its strings (it goes to JSON and back). */
export function scrubbedValue<T>(value: T, scrub: (text: string) => string): T {
  return JSON.parse(scrub(JSON.stringify(value))) as T;
}

export async function designMode(options: DesignModeOptions): Promise<DesignReport> {
  const scrub = options.scrub ?? ((text: string) => text);
  const write = options.log ?? ((line: string) => console.log(line));
  const log = (line: string) => write(scrub(line));
  const real: RealFrames | null = options.frames === 'real' ? await realFrames(options.root) : null;
  const results: (CaseOutcome & { judged?: JudgedCase })[] = [];
  const stills = new Map<string, ArtifactStore>();
  for (const entry of designCases(options.cases)) {
    const initial = madeUpVideo({
      clips: [...DESIGN_VIDEO.clips],
      captions: DESIGN_VIDEO.captions.map((cue) => [...cue] as const),
    });
    real?.footage(initial);
    const world = await designWorld(entry, {
      root: options.root,
      initial,
      timelines: real?.timelines ?? new Map(),
      frames: real?.frames ?? standInFrames,
    });
    const model = options.live ?? standInDesigner(entry, world.input, world.before?.entry);
    const outcome = await runDesignCase(entry, world, model);
    const judged =
      options.judge && outcome.placed
        ? await judgeStills(options.judge, entry.request, outcome.stills, world.artifacts)
        : undefined;
    results.push({ ...outcome, ...(judged ? { judged } : {}) });
    stills.set(entry.id, world.artifacts);
    log(
      `${outcome.pass ? 'pass' : 'FAIL'} ${outcome.id} (${outcome.renders} renders, ${outcome.turns} turns, ${(outcome.ms / 1000).toFixed(1)} s)` +
        `${outcome.why ? `: ${outcome.why}` : ''}`,
    );
    // What it did, one line: each call's tool, a refusal's code, a failed lint's findings.
    const said = (call: CaseOutcome['calls'][number]) =>
      `${call.ok ? call.name : `${call.name}!${call.code ?? ''}`}${call.findings ? `[${call.findings.join(',')}]` : ''}`;
    log(`  ${outcome.calls.map(said).join(' ')}`);
  }
  const report = scrubbedValue(designReport(options.label(), results), scrub);
  await writeDesignReport(report, options.out);
  const sheet = await writeContactSheet(report, stills, options.out);
  log(designMarkdown(report));
  log(`Contact sheet: ${sheet}`);
  return report;
}
