// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R1, work several callers share (a title set, AST's labels, CLAP's tokenizer): it runs under its own signal,
 * not the first caller's. A caller that aborts gets core.cancelled at once and the others still get the result; the
 * work itself is stopped only when every caller has left, and the next caller then starts it again.
 */
import { CancelledError, err, ok, type AsyncResult, type Result } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { shareWork } from '../../src/listen/abort';
import { createTitleEmbeddings, type TitleSet } from '../../src/listen/search/title-cache';
import type { ListenVocab } from '../../src/listen/calibrate/vocab';

/** Work that finishes when told to, or ends cancelled when its own signal aborts. */
function gate<T>(value: T) {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => (open = resolve));
  const signals: AbortSignal[] = [];
  const run = (signal: AbortSignal): AsyncResult<T> => {
    signals.push(signal);
    return new Promise<Result<T>>((resolve) => {
      signal.addEventListener('abort', () => resolve(err(CancelledError())), { once: true });
      void opened.then(() => resolve(ok(value)));
    });
  };
  return { run, open: () => open(), signals };
}

describe('shareWork', () => {
  it('one caller leaving cancels only its own wait; the work goes on for the others', async () => {
    const work = gate('rows');
    const shared = shareWork(work.run);
    const first = new AbortController();
    const a = shared.join(first.signal);
    const b = shared.join(new AbortController().signal);
    first.abort();
    expect(await a).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    work.open();
    expect(await b).toEqual(ok('rows'));
    expect(work.signals[0]?.aborted).toBe(false);
    expect(shared.abandoned).toBe(false);
  });

  it('when every caller has left, the work is stopped and marked abandoned', async () => {
    const work = gate('rows');
    const shared = shareWork(work.run);
    const one = new AbortController();
    const two = new AbortController();
    const waits = [shared.join(one.signal), shared.join(two.signal)];
    one.abort();
    await waits[0];
    expect(work.signals[0]?.aborted).toBe(false);
    two.abort();
    await waits[1];
    expect(work.signals[0]?.aborted).toBe(true);
    expect(shared.abandoned).toBe(true);
  });
});

describe('the title store’s shared make', () => {
  const set: TitleSet = { set: 'sfx-bank', version: '1', titles: ['soft pop', 'deep boom'] };

  it('the first caller’s abort does not fail the second, and the text model runs once', async () => {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => (release = resolve));
    const runs: Array<AbortSignal | undefined> = [];
    const titles = createTitleEmbeddings({
      text: {
        async queries(texts, signal) {
          runs.push(signal);
          await released;
          if (signal?.aborted) return err(CancelledError());
          const queries = texts.map((text) => ({ text, embedding: new Float32Array(512).fill(0.5) }));
          return ok({ queries, vocab: {} as ListenVocab });
        },
      },
      textModel: async () =>
        ok({ componentId: 'clap-general-text-fp16', dir: '/c/clap-general-text-fp16/1', dtype: 'fp16' }),
    });
    const first = new AbortController();
    const a = titles.embed(set, first.signal);
    const b = titles.embed(set, new AbortController().signal);
    await new Promise((resolve) => setImmediate(resolve));
    first.abort();
    expect(await a).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    release();
    const second = await b;
    expect(second.ok && second.value).toHaveLength(2);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.aborted).toBe(false);
  });
});
