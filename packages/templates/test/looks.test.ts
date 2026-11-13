// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1 looks: the pipeline describes every slot's strip once, on this Mac, and templates.resolveCuts hands the
 * description to the model in the slot's context instead of a frame to look at, so every slot's picture reaches the
 * Analyst whatever it chooses to look at. A strip it couldn't describe keeps its frame, for the Analyst to look at.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { err, NotFoundError, ok } from '@taalcut/core';
import { BREAKDOWN_FILE, type BreakdownDraft } from '../src/index';
import {
  describeStrips,
  LOOKS_FILE,
  readLooks,
  STRIP_QUESTION,
  type DescribeStrip,
} from '../src/breakdown/looks';
import type { resolveCutsOutputSchema } from '../src/tools/schemas';
import { contextDraft } from './helpers/context-draft';
import { setupTools, type ToolSetup } from './helpers/tool-setup';

const dirs: string[] = [];
let setup: ToolSetup | undefined;
afterEach(() => {
  setup?.cleanup();
  setup = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const strip = (start: number) => `strips/strip-${String(start).padStart(6, '0')}.jpg`;

/** The fixture's four slots (0–30, 30–45, 45–90, 90–120), each with its strip but the last. */
function stripDraft(): BreakdownDraft {
  const base = contextDraft([]);
  return {
    ...base,
    slotFrames: base.slotFrames.map((slot, index) =>
      index < 3 ? { ...slot, strip: strip(slot.start) } : slot,
    ),
  };
}

/** A describer that answers from the strip's name, failing for the strips in `failing`. */
function fakeDescriber(failing: readonly string[] = []): DescribeStrip & { calls: string[] } {
  const calls: string[] = [];
  const describe: DescribeStrip = async (path) => {
    calls.push(path);
    return failing.some((name) => path.endsWith(name))
      ? err(NotFoundError({ entity: 'model', id: 'vision' }))
      : ok(`a man walks away down a street, the camera following (${path.slice(-10)})`);
  };
  return Object.assign(describe, { calls });
}

describe('describeStrips', () => {
  it('describes each strip once, keeps going past one it can’t, and saves what it has', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-looks-'));
    dirs.push(dir);
    const first = fakeDescriber([strip(30)]);
    const progress: number[] = [];
    const signal = new AbortController().signal;
    const done = await describeStrips(stripDraft(), dir, first, {
      signal,
      onProgress: (fraction) => progress.push(fraction),
    });
    expect(done).toEqual({ described: 2, failed: 1 });
    expect(first.calls.map((path) => path.slice(dir.length + 1))).toEqual([strip(0), strip(30), strip(45)]);
    expect(Object.keys(await readLooks(dir)).sort()).toEqual([strip(0), strip(45)]);
    expect(progress.at(-1)).toBe(1);
    // Again (the same reel's breakdown): only the strip without a description is asked about.
    const second = fakeDescriber();
    expect(await describeStrips(stripDraft(), dir, second, { signal })).toEqual({ described: 1, failed: 0 });
    expect(second.calls.map((path) => path.slice(dir.length + 1))).toEqual([strip(30)]);
    expect(Object.keys(JSON.parse(readFileSync(join(dir, LOOKS_FILE), 'utf8')))).toHaveLength(3);
  });

  it('asks about nothing once the call is cancelled, and reads no descriptions from a broken file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-looks-'));
    dirs.push(dir);
    const controller = new AbortController();
    controller.abort();
    const describer = fakeDescriber();
    expect(await describeStrips(stripDraft(), dir, describer, { signal: controller.signal })).toEqual({
      described: 0,
      failed: 0,
    });
    expect(describer.calls).toEqual([]);
    writeFileSync(join(dir, LOOKS_FILE), '{not json');
    expect(await readLooks(dir)).toEqual({});
  });
});

describe('the question about a strip', () => {
  it('tells the describer what the breakdown measured, so two alike pictures don’t read as a still camera', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-looks-'));
    dirs.push(dir);
    const base = stripDraft();
    // Slot 0 measured moving, slot 1 measured still, slot 2 unmeasured.
    const draft = {
      ...base,
      slotFrames: base.slotFrames.map((slot, index) =>
        index === 0 ? { ...slot, motion: 0.09 } : index === 1 ? { ...slot, motion: 0.002 } : slot,
      ),
    };
    const questions: string[] = [];
    await describeStrips(
      draft,
      dir,
      async (_path, { question }) => {
        questions.push(question);
        return ok('a man walks away down a street');
      },
      { signal: new AbortController().signal },
    );
    expect(questions[0]).toContain('The camera moves during this shot');
    expect(questions[0]).not.toMatch(/\bstill\b/);
    expect(questions[1]).toContain('barely moves');
    expect(questions[2]).toBe(STRIP_QUESTION);
  });
});

describe('templates.resolveCuts with looks', () => {
  it('hands a described strip over as words and keeps the frame of one it couldn’t describe', async () => {
    setup = setupTools({ contextWindow: 32_768 });
    const id = setup.deps.ids.experiment();
    const scratch = await setup.sandbox.open({ id, projectId: setup.projectA, purpose: 'breakdown' });
    if (!scratch.ok) throw new Error(scratch.error.code);
    const dir = scratch.value.dir;
    writeFileSync(join(dir, BREAKDOWN_FILE), JSON.stringify({ ...stripDraft(), breakdownId: id }));
    await describeStrips(stripDraft(), dir, fakeDescriber([strip(30)]), {
      signal: new AbortController().signal,
    });
    const out = await setup.value<z.output<typeof resolveCutsOutputSchema>>('templates.resolveCuts', {
      breakdownId: id,
    });
    expect(
      out.slots.map((slot) => [slot.frame === null, slot.context.looks?.startsWith('a man walks')]),
    ).toEqual([
      [true, true],
      [false, undefined],
      [true, true],
      [false, undefined],
    ]);
    expect(out.slots[1]?.frame).toBe(join(dir, strip(30)));
  });
});
