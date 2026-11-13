// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-F14: the indexing harness decodes as the app does, from the same switch (`TAALCUT_DECODE_SERVICE`) with the
 * same default (IX3-R2, `mac-helper`: the analysis pass and the frame reads through the mac helper); no helper, no
 * service.
 */
import { join } from 'node:path';
import { err, ok } from '@taalcut/core';
import { DECODE_SERVICE_ENV, SidecarNotFound } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import { evalDecodeService } from '../../src/search/eval-decode';

const helper = { resolve: async () => ok({ path: '/helpers/taalcut-mac-helper', source: 'env' as const }) };
const noHelper = { resolve: async () => err(SidecarNotFound({ binary: 'taalcut-mac-helper' })) };

describe('evalDecodeService', () => {
  it('takes the switch as the app does: unset is mac-helper (both), frames, off none, junk the default', async () => {
    const lines: string[] = [];
    const open = (value?: string) =>
      evalDecodeService(['/library'], {
        env: value === undefined ? {} : { [DECODE_SERVICE_ENV]: value },
        resolver: helper,
        log: (line) => lines.push(line),
      });
    expect((await open())?.tasks).toEqual(['pass', 'frames']);
    expect((await open('frames'))?.tasks).toEqual(['frames']);
    expect((await open('mac-helper'))?.tasks).toEqual(['pass', 'frames']);
    expect(await open('off')).toBeUndefined();
    expect(lines).toEqual([]);
    expect((await open('helper'))?.tasks).toEqual(['pass', 'frames']);
    expect(lines).toEqual([
      '[media] decode service: TAALCUT_DECODE_SERVICE=helper is not one of off, frames, mac-helper: mac-helper, the default',
    ]);
  });

  it('opens none without a helper: FFmpeg decodes everything, said once', async () => {
    const lines: string[] = [];
    const service = await evalDecodeService([join('/no', 'library')], {
      env: {},
      resolver: noHelper,
      log: (line) => lines.push(line),
    });
    expect(service).toBeUndefined();
    expect(lines).toEqual([
      '[media] decode service: no mac helper (media.sidecar_not_found); FFmpeg decodes',
    ]);
  });
});
