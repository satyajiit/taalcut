// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Gate criterion 4: no file reaches renders/ without a passing report.
 * finalizeRender is the only way in; overrides are the user's, only on
 * overridable failures; and nothing else in the package marks a render ready.
 */
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { err, newId, UnknownError, type QaCheckResult, type RenderId, type RenderRecord } from '@taalcut/core';
import { finalizeRender, markNeedsAttention, overrideQa, type FinalizeFs } from '../../src/qa/finalize';
import { autoFix, checkResult } from '../../src/qa/result';
import { cardChecks, mergeRerun, summarize, verdictOf } from '../../src/qa/verdict';
import { memoryRenderStore, type MemoryRenderStore } from '../support/render-store';
import { tempDir } from '../support/media';
import { clock, report } from './support';

const SRC = join(import.meta.dirname, '../../src');
const pass = (id: QaCheckResult['id']) => checkResult(id, 'pass', {}, 0);
const fail = (id: QaCheckResult['id']) => checkResult(id, 'fail', { fixes: [autoFix('rerender')] }, 0);
const warn = (id: QaCheckResult['id']) => checkResult(id, 'warn', {}, 0);

function record(id: RenderId, overrides: Partial<RenderRecord> = {}) {
  // Only the fields finalize reads matter; the rest of the row is the library's.
  return { id, status: 'checking', deletedAt: null, filePath: null, qaReport: null, requestKey: 'k', ...overrides } as unknown as
    RenderRecord & { requestKey: string };
}

describe('finalizeRender', () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  let store: MemoryRenderStore;
  let id: RenderId;
  let workFile: string;
  let destination: string;

  beforeEach(async () => {
    work = await tempDir('qa-gate');
    store = memoryRenderStore();
    id = newId<'Render'>();
    store.records.set(id, record(id));
    workFile = join(work.dir, 'work', 'out.mp4');
    destination = join(work.dir, 'renders', 'project', `${id}.mp4`);
    await mkdir(join(work.dir, 'work'), { recursive: true });
    await writeFile(workFile, 'mp4 bytes');
  });
  afterEach(() => work.dispose());

  const exists = (path: string) => stat(path).then(() => true, () => false);

  it('delivers a passed render: file moved, row ready with its report', async () => {
    const qa = report([pass('container'), warn('bitrate')], { renderId: id });
    const sidecar = join(work.dir, 'work', 'out.srt');
    await writeFile(sidecar, '1\n');
    const result = await finalizeRender(
      { store, clock },
      { renderId: id, workFile, destination, report: qa, sidecars: [{ from: sidecar, to: destination.replace('.mp4', '.srt') }] },
    );
    expect(result.ok).toBe(true);
    expect(await readFile(destination, 'utf8')).toBe('mp4 bytes');
    expect(await exists(workFile)).toBe(false);
    expect(await exists(destination.replace('.mp4', '.srt'))).toBe(true);
    expect(store.updates).toEqual([
      {
        id,
        patch: {
          status: 'ready',
          filePath: destination,
          bytes: 9,
          qa: summarize(qa),
          qaReport: qa,
          error: null,
          finishedAt: clock.now(),
        },
      },
    ]);
  });

  it.each([
    ['needsAttention', report([fail('avSync')])],
    ['a report claiming passed over a failing check', report([fail('avSync')], { verdict: 'passed' })],
    ['an override of a check that may not be overridden', report([fail('avSync')], { verdict: 'overridden', overrides: [{ check: 'avSync', at: 1, actor: 'user' }] })],
  ])('refuses %s: no file in renders/, no ready row', async (_case, qa) => {
    const result = await finalizeRender({ store, clock }, { renderId: id, workFile, destination, report: { ...qa, renderId: id } });
    expect(result.ok ? undefined : result.error.code).toBe('render.qa_not_passed');
    expect(await exists(destination)).toBe(false);
    expect(await exists(workFile)).toBe(true);
    expect(store.updates).toEqual([]);
  });

  it("refuses another render's report", async () => {
    const result = await finalizeRender({ store, clock }, { renderId: id, workFile, destination, report: report([pass('codec')]) });
    expect(result.ok ? undefined : result.error.code).toBe('core.validation');
    expect(await exists(destination)).toBe(false);
  });

  it.each([{ status: 'cancelled' as const }, { deletedAt: 5 }])('refuses a render that is %o', async (state) => {
    store.records.set(id, record(id, state));
    const result = await finalizeRender({ store, clock }, { renderId: id, workFile, destination, report: report([pass('codec')], { renderId: id }) });
    expect(result.ok).toBe(false);
    expect(await exists(destination)).toBe(false);
  });

  it('copies across volumes when rename says EXDEV', async () => {
    let renames = 0;
    const fs: FinalizeFs = {
      rename: async (from, to) => {
        if (renames++ === 0) throw Object.assign(new Error('cross-device'), { code: 'EXDEV' });
        await rename(from, to);
      },
      copyFile,
      mkdir,
      stat,
      rm,
    };
    const result = await finalizeRender({ store, clock, fs }, { renderId: id, workFile, destination, report: report([pass('codec')], { renderId: id }) });
    expect(result.ok).toBe(true);
    expect(await exists(destination)).toBe(true);
    expect(await exists(`${destination}.part`)).toBe(false);
    expect(await exists(workFile)).toBe(false);
  });

  it('puts the file back when the row cannot be updated', async () => {
    const failing = { get: store.get, update: async () => err(UnknownError(undefined, { detail: 'database locked' })) };
    const result = await finalizeRender({ store: failing, clock }, { renderId: id, workFile, destination, report: report([pass('codec')], { renderId: id }) });
    expect(result.ok).toBe(false);
    expect(await exists(destination)).toBe(false);
    expect(await exists(workFile)).toBe(true);
  });

  it('marks a render that ran out of fixes as needing attention, file untouched', async () => {
    const qa = report([fail('loudness')], { renderId: id });
    const result = await markNeedsAttention({ store, clock }, { renderId: id, report: qa });
    expect(result.ok && result.value.status).toBe('needsAttention');
    expect(await exists(workFile)).toBe(true);
    expect(store.updates[0]?.patch).not.toHaveProperty('filePath');
  });

  it('delivers once the user overrides every failing, overridable check', async () => {
    const qa = report([fail('loudness'), fail('blackFrames'), pass('codec')], { renderId: id });
    const partial = overrideQa(qa, ['loudness'], 'user', 10);
    expect(partial.ok && partial.value.verdict).toBe('needsAttention');
    const full = overrideQa(partial.ok ? partial.value : qa, ['blackFrames', 'loudness'], 'user', 11);
    if (!full.ok) throw new Error(full.error.code);
    expect(full.value.verdict).toBe('overridden');
    expect(full.value.overrides.map((entry) => entry.check)).toEqual(['loudness', 'blackFrames']);
    expect((await finalizeRender({ store, clock }, { renderId: id, workFile, destination, report: full.value })).ok).toBe(true);
  });
});

describe('overrideQa', () => {
  const qa = report([fail('avSync'), fail('loudness'), pass('codec')]);

  it.each(['avSync', 'codec', 'beatSync'] as const)('refuses %s (not overridable, passing, or not in the report)', (check) => {
    const result = overrideQa(qa, [check], 'user', 1);
    expect(result.ok ? undefined : result.error).toMatchObject({ code: 'render.override_refused', params: { check } });
  });

  it('lets a too-short duration be overridden, never a too-long one', () => {
    const short = checkResult('duration', 'fail', { overridable: true }, 0);
    const long = checkResult('duration', 'fail', {}, 0);
    expect(overrideQa(report([short]), ['duration'], 'user', 1).ok).toBe(true);
    expect(overrideQa(report([long]), ['duration'], 'user', 1).ok).toBe(false);
  });
});

describe('verdicts', () => {
  it('reads passed, passedWithWarnings, needsAttention', () => {
    expect(verdictOf([pass('codec'), checkResult('loudness', 'skipped', {}, 0)], [])).toBe('passed');
    expect(verdictOf([pass('codec'), warn('bitrate')], [])).toBe('passedWithWarnings');
    expect(verdictOf([fail('codec'), warn('bitrate')], [])).toBe('needsAttention');
  });

  it('marks a check that passes after its fix as fixed, and counts it as passing', () => {
    const merged = mergeRerun([fail('loudness'), pass('codec'), fail('container')], [pass('loudness'), fail('container')]);
    expect(merged.map((check) => [check.id, check.status])).toEqual([
      ['container', 'fail'],
      ['codec', 'pass'],
      ['loudness', 'fixed'],
    ]);
    expect(verdictOf(merged.filter((check) => check.id !== 'container'), [])).toBe('passed');
  });

  it('puts failures first on the card', () => {
    const checks = [warn('bitrate'), pass('codec'), checkResult('loudness', 'fixed', {}, 0), fail('avSync')];
    expect(cardChecks({ checks }).map((check) => check.id)).toEqual(['avSync', 'loudness', 'bitrate']);
  });
});

describe('the only writer of status ready', () => {
  async function sources(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => (entry.isDirectory() ? sources(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)]))),
    );
    return nested.flat().filter((file) => file.endsWith('.ts'));
  }

  it("is finalize.ts: no other source in the package writes status 'ready'", async () => {
    const writers: string[] = [];
    for (const file of await sources(SRC)) {
      if (/status\s*:\s*['"`]ready['"`]/.test(await readFile(file, 'utf8'))) writers.push(relative(SRC, file));
    }
    expect(writers).toEqual(['qa/finalize.ts']);
  });
});
