// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { MediaCancelled, SidecarFailed, SidecarRejected, type JsonValue } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import { APPLY_CUBE_METHOD, createHelperCubeApplier } from '../../src/grade/cube-applier';

const request = {
  input: '/work/seg.mp4',
  output: '/work/seg.graded.mp4',
  cube: '/cache/look.cube',
  colourSpace: 'bt709',
} as const;

interface Options {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly settleOnReply?: boolean;
  readonly onLetGo?: () => void;
  readonly onSend?: (pid: number) => void;
}

function helperAnswering(answer: () => AsyncResult<JsonValue>) {
  const calls: { method: string; params: JsonValue; timeoutMs?: number; options?: Options }[] = [];
  return {
    calls,
    helper: {
      request(method: string, params: JsonValue, options?: Options) {
        calls.push({
          method,
          params,
          ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
          ...(options ? { options } : {}),
        });
        return answer();
      },
    },
  };
}

const rejected = (helperCode: string): AsyncResult<JsonValue> =>
  Promise.resolve(err(SidecarRejected({ helperCode }, { detail: `${helperCode} happened` })));

describe('createHelperCubeApplier', () => {
  it('asks the helper for video.applyCube with the four params and reads its result', async () => {
    const { calls, helper } = helperAnswering(() =>
      Promise.resolve(
        ok({ output: request.output, width: 1080, height: 1920, frames: 61, compute: 'gpu', ms: 412 }),
      ),
    );
    const applier = createHelperCubeApplier(helper);
    expect(applier.sizes).toEqual([17]);
    const applied = await applier.apply(request);
    expect(applied).toEqual(ok({ kind: 'applied', frames: 61, ms: 412 }));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe(APPLY_CUBE_METHOD);
    expect(calls[0]?.params).toEqual(request);
    expect(calls[0]?.timeoutMs).toBeGreaterThan(60_000);
  });

  it('waits for the helper after a cancel or a timeout and hands it the send and the let-go (IX3-F5 H5, IX3-F7)', async () => {
    const { calls, helper } = helperAnswering(() =>
      Promise.resolve(ok({ output: request.output, width: 1, height: 1, frames: 1, compute: 'gpu', ms: 1 })),
    );
    const signal = new AbortController().signal;
    const onLetGo = () => undefined;
    const onSend = () => undefined;
    await createHelperCubeApplier(helper).apply(request, { signal, onSend, onLetGo });
    expect(calls[0]?.options).toMatchObject({ signal, settleOnReply: true, onSend, onLetGo });
  });

  it('turns grade.no_metal into a no-accelerator outcome, not an error', async () => {
    const applied = await createHelperCubeApplier(
      helperAnswering(() => rejected('grade.no_metal')).helper,
    ).apply(request);
    expect(applied.ok && applied.value.kind).toBe('noAccelerator');
  });

  it('maps the helper errors to render errors', async () => {
    const codeOf = async (answer: () => AsyncResult<JsonValue>): Promise<TaalcutError | null> => {
      const applied = await createHelperCubeApplier(helperAnswering(answer).helper).apply(request);
      return applied.ok ? null : applied.error;
    };
    expect((await codeOf(() => rejected('grade.cube_invalid')))?.code).toBe('render.cube_invalid');
    const failed = await codeOf(() => Promise.resolve(err(SidecarFailed({ helperCode: 'grade.failed' }))));
    expect(failed?.code).toBe('render.grade_failed');
    expect(failed?.retryable).toBe(true);
    expect((await codeOf(() => rejected('grade.unreadable')))?.code).toBe('render.grade_failed');
    expect((await codeOf(() => rejected('helper.path_not_allowed')))?.detail).toContain(
      'helper.path_not_allowed',
    );
    expect((await codeOf(() => Promise.resolve(err(MediaCancelled()))))?.code).toBe('core.cancelled');
  });

  it('refuses a result that is not the helper spec shape', async () => {
    const applied = await createHelperCubeApplier(
      helperAnswering(() => Promise.resolve(ok({ output: 'x', frames: 3, compute: 'cpu' }))).helper,
    ).apply(request);
    expect(applied.ok).toBe(false);
    if (!applied.ok) expect(applied.error.code).toBe('render.grade_failed');
  });
});
