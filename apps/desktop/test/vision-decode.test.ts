// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's decode service (IX2-V3, G3, F14, IX3-R2): media's switch decides what the mac helper takes (unset
 * and `mac-helper`: the analysis pass and the frame reads; `frames`: the frame reads only; `off`: nothing, no service;
 * anything else the default, with one warning), and without a helper there is no service: FFmpeg decodes everything,
 * said once, not a crash.
 */
import { join } from 'node:path';
import { createContainer, ok } from '@taalcut/core';
import { DECODE_SERVICE_ENV, serviceFor, type DecodeService } from '@taalcut/media';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { visionDecodeService } from '../src/utility/roots/vision-decode';
import { testConfig } from './helpers/roots';

afterEach(() => {
  vi.unstubAllEnvs();
});

const takes = (service: DecodeService | undefined) =>
  (['pass', 'frames'] as const).filter((task) => serviceFor(service, task) !== undefined);

const helper = { resolve: async () => ok({ path: '/helpers/taalcut-mac-helper', source: 'env' as const }) };

describe('visionDecodeService', () => {
  it('takes the pass and the frame reads unless switched (the default), the frame reads with frames, nothing when off', async () => {
    const config = testConfig('jobs');
    const lines: string[] = [];
    const service = (value?: string) =>
      visionDecodeService(createContainer(), config, {
        env: value === undefined ? {} : { [DECODE_SERVICE_ENV]: value },
        resolver: helper,
        log: (line) => lines.push(line),
      });
    expect(takes(await service())).toEqual(['pass', 'frames']);
    expect((await service())?.id).toBe('mac-helper');
    expect(takes(await service('frames'))).toEqual(['frames']);
    expect(takes(await service(' mac-helper '))).toEqual(['pass', 'frames']);
    expect(await service('off')).toBeUndefined();
    expect(lines).toEqual([]);
    expect(takes(await service('ffmpeg'))).toEqual(['pass', 'frames']);
    expect(lines).toEqual([
      '[media] decode service: TAALCUT_DECODE_SERVICE=ffmpeg is not one of off, frames, mac-helper: mac-helper, the default',
    ]);
  });

  it('opens no service where no helper resolves: FFmpeg decodes everything, said once', async () => {
    const config = testConfig('jobs');
    vi.stubEnv('TAALCUT_MAC_HELPER', join(config.userData, 'missing', 'taalcut-mac-helper'));
    const open = async (env: Record<string, string>) => {
      const lines: string[] = [];
      const service = await visionDecodeService(createContainer(), config, {
        env,
        log: (l) => lines.push(l),
      });
      return { service, lines };
    };
    const missing = ['[media] decode service: no mac helper (media.sidecar_not_found); FFmpeg decodes'];
    expect(await open({})).toEqual({ service: undefined, lines: missing });
    expect(await open({ [DECODE_SERVICE_ENV]: 'mac-helper' })).toEqual({
      service: undefined,
      lines: missing,
    });
    // Switched off, nothing looks for a helper.
    expect(await open({ [DECODE_SERVICE_ENV]: 'off' })).toEqual({ service: undefined, lines: [] });
  });
});
