// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-C1 through the whole pipeline, on the scripted reel (helpers/scripted-analysers.ts) with a fake listener: the
 * listening stage in the progress, the listening in the draft and under the template's slots, and a breakdown that
 * completes with `listening_unavailable` when no model is installed.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createManualClock,
  newId,
  RationalTime,
  templateSchema,
  type JobProgress,
  type Template,
} from '@taalcut/core';
import {
  BREAKDOWN_STAGE_KEYS,
  buildTemplate,
  LISTENING_UNAVAILABLE,
  runBreakdown,
  type BreakdownAnalysers,
  type BreakdownAudio,
  type BreakdownDraft,
} from '../src/index';
import { sequentialIds } from './helpers/fixtures';
import { fakeListener, missingModelListener } from './helpers/listening-fakes';
import { scriptedAnalysers } from './helpers/scripted-analysers';

const root = mkdtempSync(join(tmpdir(), 'taalcut-listening-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function breakDown(listen: BreakdownAudio['listen'] | undefined) {
  const scripted = scriptedAnalysers();
  const analysers: BreakdownAnalysers = {
    ...scripted,
    audio: { ...scripted.audio, ...(listen ? { listen } : {}) },
  };
  const stages: string[] = [];
  const draft = await runBreakdown(
    {
      breakdownId: newId(),
      referencePath: join(root, 'reel.mp4'),
      input: 'file',
      platform: null,
      url: null,
      fingerprint: 'c'.repeat(64),
    },
    { ...analysers, experimentDir: root, clock: createManualClock(1) },
    {
      signal: new AbortController().signal,
      progress: (progress: JobProgress) => stages.push(progress.stageKey ?? ''),
    },
  );
  if (!draft.ok) throw new Error(`${draft.error.code}: ${draft.error.detail ?? ''}`);
  return { draft: draft.value, stages };
}

function template(draft: BreakdownDraft): Template {
  const built = buildTemplate(draft, [], [], sequentialIds(), { createdAt: 1 });
  if (!built.ok) throw new Error(built.error.detail);
  return templateSchema.parse(built.value);
}

const candidates = (draft: BreakdownDraft) =>
  [...draft.cuts, ...draft.disputes].map((cut) => cut.frame).sort((a, b) => a - b);

describe('the breakdown listens to the reel (EAR1-C1)', () => {
  it('listens to every candidate cut from the cuts on, and waits for it after the audio, before the transitions', async () => {
    const { listen, calls } = fakeListener(() => ({
      status: 'ok',
      offsetMs: 12,
      event: { kind: 'whoosh', tags: [{ term: 'a fast air whoosh', kind: 'whoosh', z: 2.1 }] },
    }));
    const { draft, stages } = await breakDown(listen);
    const audioAt = stages.indexOf(BREAKDOWN_STAGE_KEYS.audio);
    expect(stages.indexOf(BREAKDOWN_STAGE_KEYS.listening)).toBe(audioAt + 1);
    expect(stages[audioAt + 2]).toBe(BREAKDOWN_STAGE_KEYS.transitions);
    expect(calls).toHaveLength(1);
    const rate = draft.canvas.rate;
    expect(calls[0]!.cuts.map((cut) => cut.value)).toEqual(
      candidates(draft).map((frame) => Math.round((frame * rate.den * 1000) / rate.num)),
    );
    // Started before the tracker's beats are known: earshot's own grid gives the beat offsets.
    expect(calls[0]!.beats).toBe(0);
    expect(calls[0]!.frameRate).toEqual(draft.canvas.rate);
    expect(draft.warnings).not.toContain(LISTENING_UNAVAILABLE);
    expect(draft.audio.listening?.sfxAtCuts).toHaveLength(candidates(draft).length);
  });

  it('keeps the listening under the template’s slots: each cut’s sync and effect at its slot’s index', async () => {
    const { listen } = fakeListener((index) =>
      index % 2 === 0 ? { status: 'ok', offsetMs: 0, event: { band: 'low' } } : { status: 'none' },
    );
    const { draft } = await breakDown(listen);
    const made = template(draft);
    const listening = made.audio.listening!;
    const slotCuts = made.slots.slice(1).map((slot, i) => ({ index: i + 1, frame: slot.start.value }));
    expect(listening.cutSync.items.map((item) => item.cutIndex)).toEqual(slotCuts.map((cut) => cut.index));
    for (const item of listening.cutSync.items) expect(item.at).toEqual(made.slots[item.cutIndex]!.start);
    // Each effect is the one the breakdown heard on the cut at that slot's start.
    const heard = new Map(
      draft.audio.listening!.cutSync.items.map((item) => [item.at.value, item.status === 'ok']),
    );
    expect(listening.sfxAtCuts.map((effect) => effect.cutIndex)).toEqual(
      slotCuts.filter((cut) => heard.get(cut.frame)).map((cut) => cut.index),
    );
    expect(listening.sfxAtCuts.every((effect) => effect.family === 'impact')).toBe(true);
    expect(RationalTime.toSeconds(listening.measures.duration)).toBe(12);
  });

  it('completes without the models: no listening, the warning listening_unavailable', async () => {
    const { draft, stages } = await breakDown(missingModelListener());
    expect(stages).toContain(BREAKDOWN_STAGE_KEYS.listening);
    expect(draft.warnings).toContain(LISTENING_UNAVAILABLE);
    expect(draft.audio.listening).toBeNull();
    expect(template(draft).audio.listening).toBeNull();
  });

  it('analysers that can’t listen leave the listening out', async () => {
    const { draft } = await breakDown(undefined);
    expect('listening' in draft.audio).toBe(false);
    expect(draft.warnings).not.toContain(LISTENING_UNAVAILABLE);
    expect('listening' in template(draft).audio).toBe(false);
  });
});
