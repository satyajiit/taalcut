// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** GPU first (ADR 0002): backend selection and the compute.fallback event. */
import { describe, expect, it } from 'vitest';
import {
  COMPUTE_BACKENDS,
  computeFallbackEvent,
  computeKind,
  cpuFallback,
  createEventBus,
  createManualClock,
  selectBackend,
  taalcutEventSchema,
  type BackendChoice,
  type TaalcutEvent,
} from '@taalcut/core';

describe('selectBackend', () => {
  it('picks the first available accelerated candidate, in the caller order', () => {
    expect(selectBackend(['metal', 'coreml', 'cpu'], ['coreml', 'metal'])).toEqual({
      ok: true,
      value: { backend: 'metal', kind: 'gpu', fallback: null },
    });
    expect(selectBackend(['ane', 'metal'], (backend) => backend === 'ane')).toEqual({
      ok: true,
      value: { backend: 'ane', kind: 'npu', fallback: null },
    });
  });

  it('never prefers the CPU while an accelerated candidate is available, wherever it is listed', () => {
    const choice = selectBackend(['cpu', 'videotoolbox'], new Set(['cpu', 'videotoolbox'] as const));
    expect(choice).toMatchObject({ ok: true, value: { backend: 'videotoolbox', fallback: null } });
  });

  it('falls back to the CPU only with a reason and its message key', () => {
    expect(selectBackend(['metal', 'cpu'], [])).toEqual({
      ok: true,
      value: {
        backend: 'cpu',
        kind: 'cpu',
        fallback: { reason: 'no_accelerator', messageKey: 'compute.fallback.no_accelerator' },
      },
    });
    const unsupported = selectBackend(['videotoolbox', 'cpu'], ['metal'], {
      fallbackReason: 'unsupported_input',
      detail: 'ProRes RAW',
    });
    expect(unsupported).toMatchObject({
      ok: true,
      value: { backend: 'cpu', fallback: { reason: 'unsupported_input', detail: 'ProRes RAW' } },
    });
  });

  it('fails when nothing is available and the CPU is not a candidate', () => {
    expect(selectBackend(['metal', 'ane'], ['cuda'])).toMatchObject({
      ok: false,
      error: { code: 'core.compute_unavailable', params: { candidates: 'metal, ane' } },
    });
  });

  it('classifies every backend', () => {
    expect(computeKind('cpu')).toBe('cpu');
    expect(computeKind('nvenc')).toBe('gpu');
    expect(computeKind('ane')).toBe('npu');
    expect(Object.values(COMPUTE_BACKENDS).filter((kind) => kind === 'cpu')).toHaveLength(1);
  });
});

describe('compute.fallback event', () => {
  it('records what wanted acceleration and why it ran on the CPU', () => {
    const bus = createEventBus({ clock: createManualClock(5) });
    const seen: TaalcutEvent[] = [];
    bus.onAny((event) => seen.push(event), ['compute.fallback']);
    const choice: BackendChoice = cpuFallback('accelerator_failed', 'MTLCommandBuffer error');
    if (!choice.fallback) throw new Error('expected a fallback');
    bus.emit(
      'compute.fallback',
      computeFallbackEvent('vision.embedFrames', ['coreml', 'metal', 'cpu'], choice.fallback),
    );
    expect(seen).toEqual([
      {
        type: 'compute.fallback',
        at: 5,
        payload: {
          operation: 'vision.embedFrames',
          wanted: ['coreml', 'metal'],
          reason: 'accelerator_failed',
          detail: 'MTLCommandBuffer error',
        },
      },
    ]);
    expect(taalcutEventSchema.safeParse(seen[0]).success).toBe(true);
    expect(computeFallbackEvent('x', ['cpu'], cpuFallback('disabled').fallback!)).toEqual({
      operation: 'x',
      wanted: [],
      reason: 'disabled',
    });
  });
});
