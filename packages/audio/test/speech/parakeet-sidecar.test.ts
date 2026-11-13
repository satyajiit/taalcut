// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Parakeet sidecar args, progress, and helper-code lifting. No process is spawned. */
import { ok, type TaalcutError } from '@taalcut/core';
import type { JsonLineSidecar, JsonLineSidecarOptions } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import {
  createParakeetSidecar,
  parakeetServeArgs,
  speechSidecarFromJsonLine,
} from '../../src/speech/parakeet-sidecar';

const MODELS = '/Library/Application Support/Taalcut/components/parakeet-tdt-0-6b-v3-coreml';

function rejected(helperCode: string): TaalcutError {
  return {
    code: 'media.sidecar_rejected',
    messageKey: 'errors.media.sidecar_rejected',
    retryable: false,
    params: { helperCode },
    detail: helperCode,
  };
}

describe('parakeet sidecar', () => {
  it('points --models at the int8 component and allows each root', () => {
    expect(parakeetServeArgs(MODELS, ['/Users/me/Footage', '/tmp/slices'])).toEqual([
      'serve',
      '--services',
      'asr',
      '--models',
      MODELS,
      '--allow-root',
      '/Users/me/Footage',
      '--allow-root',
      '/tmp/slices',
    ]);
  });

  it('opens the JSON-line client with those args and a 120s idle exit', () => {
    let seen: JsonLineSidecarOptions | undefined;
    const sidecar: JsonLineSidecar = {
      ready: () => Promise.resolve(ok({})),
      request: () => Promise.resolve(ok({})),
      close: () => Promise.resolve(),
    };
    createParakeetSidecar(
      { command: '/usr/local/bin/taalcut-mac-helper', modelsDir: MODELS, allowRoots: ['/tmp/slices'] },
      (options) => {
        seen = options;
        return sidecar;
      },
    );
    expect(seen).toEqual({
      command: '/usr/local/bin/taalcut-mac-helper',
      args: parakeetServeArgs(MODELS, ['/tmp/slices']),
      idleExitMs: 120_000,
    });
  });

  it('forwards progress fractions and lifts asr.model_load_failed onto error.code', async () => {
    const fractions: number[] = [];
    const sidecar = speechSidecarFromJsonLine({
      ready: () => Promise.resolve(ok({})),
      request: (_method, _params, options) => {
        options?.onNotification?.({ type: 'progress', fraction: 0.25 });
        options?.onNotification?.({ type: 'progress', fraction: 'nope' as unknown as number });
        return Promise.resolve(ok({ text: 'hello' }));
      },
      close: () => Promise.resolve(),
    });
    const loaded = await sidecar.request(
      'asr.transcribe',
      { path: '/tmp/slices/a.wav' },
      {
        onProgress: (fraction) => fractions.push(fraction),
      },
    );
    expect(loaded.ok && loaded.value).toEqual({ text: 'hello' });
    expect(fractions).toEqual([0.25]);

    const failed = speechSidecarFromJsonLine({
      ready: () => Promise.resolve(ok({})),
      request: () => Promise.resolve({ ok: false, error: rejected('asr.model_load_failed') }),
      close: () => Promise.resolve(),
    });
    const result = await failed.request('asr.load', { version: 'v3', encoderPrecision: 'int8' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('asr.model_load_failed');
  });

  it('maps a cancelled helper request to core.cancelled', async () => {
    const sidecar = speechSidecarFromJsonLine({
      ready: () => Promise.resolve(ok({})),
      request: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: 'media.cancelled',
            messageKey: 'errors.media.cancelled',
            retryable: false,
          },
        }),
      close: () => Promise.resolve(),
    });
    const result = await sidecar.request('asr.transcribe', {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('core.cancelled');
  });
});
