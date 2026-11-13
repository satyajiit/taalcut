// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-F14, IX3-R2: the decode service switch (`TAALCUT_DECODE_SERVICE`: off, frames, mac-helper; unset or anything else
 * is the default, `mac-helper`, the latter with one warning), and the service `openDecodeService` opens from it: the helper's,
 * one helper process per set of folders, taking the setting's tasks; none where no helper resolves (every decode on
 * FFmpeg, said once) or when switched off.
 */
import { err, ok } from '@taalcut/core';
import {
  DECODE_SERVICE_ENV,
  decodeServiceChoice,
  decodeServiceWarning,
  DEFAULT_DECODE_SERVICE,
  helperDecodeService,
  openDecodeService,
  serviceFor,
  SidecarNotFound,
  type DecodePassRequest,
  type DecodeService,
  type JsonLineEventSidecar,
  type JsonLineSidecarOptions,
} from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import { fakeService } from './helpers/fake-decode';

describe('the decode service switch', () => {
  it('is mac-helper by default: the analysis pass and the frame reads through the service', () => {
    expect(DEFAULT_DECODE_SERVICE).toBe('mac-helper');
    for (const unset of [undefined, '', '  ']) {
      const choice = decodeServiceChoice(unset);
      expect(choice).toEqual({ setting: 'mac-helper', tasks: ['pass', 'frames'] });
      expect(decodeServiceWarning(choice)).toBeUndefined();
    }
  });

  it('names off, frames and mac-helper', () => {
    expect(decodeServiceChoice('off')).toEqual({ setting: 'off', tasks: [] });
    expect(decodeServiceChoice('frames')).toEqual({ setting: 'frames', tasks: ['frames'] });
    expect(decodeServiceChoice(' mac-helper ')).toEqual({ setting: 'mac-helper', tasks: ['pass', 'frames'] });
  });

  it('takes the default for anything else, with one warning naming the value', () => {
    for (const junk of ['on', 'FRAMES', '1', 'ffmpeg']) {
      const choice = decodeServiceChoice(junk);
      expect(choice).toEqual({ setting: 'mac-helper', tasks: ['pass', 'frames'], unknown: junk });
      expect(decodeServiceWarning(choice)).toBe(
        `${DECODE_SERVICE_ENV}=${junk} is not one of off, frames, mac-helper: mac-helper, the default`,
      );
    }
  });

  it('gives a decode to the service only when it takes that task (one that does not say takes both)', () => {
    const both = fakeService(async () => ok({ frames: 0, sets: [], ms: 0 }));
    expect(serviceFor(both, 'pass')).toBe(both);
    expect(serviceFor(both, 'frames')).toBe(both);
    const framesOnly: DecodeService = { ...both, tasks: ['frames'] };
    expect(serviceFor(framesOnly, 'pass')).toBeUndefined();
    expect(serviceFor(framesOnly, 'frames')).toBe(framesOnly);
    const none: DecodeService = { ...both, tasks: [] };
    expect(serviceFor(none, 'frames')).toBeUndefined();
    expect(serviceFor(undefined, 'frames')).toBeUndefined();
  });
});

const request: DecodePassRequest = {
  path: '/library/clip.mov',
  rate: { num: 30, den: 1 },
  window: { from: 0, frames: 30 },
  rotation: 0,
  range: 'video',
  analysis: { width: 144, height: 256, path: '/frames/a.nv12' },
  sets: [],
};

/** Helpers started by the service under test: their options, and the requests each got. */
function fakeHelpers() {
  const opened: JsonLineSidecarOptions[] = [];
  const sent: string[] = [];
  let closed = 0;
  const open = (options: JsonLineSidecarOptions): JsonLineEventSidecar => {
    opened.push(options);
    return {
      ready: async () => ok({}),
      request: async (method, _params, requestOptions) => {
        sent.push(method);
        requestOptions?.onLetGo?.();
        return ok({ frames: 30, decoded: 30, sets: [], fullRange: false, ms: 5 });
      },
      close: async () => {
        closed += 1;
      },
      onEvent: () => () => {},
    };
  };
  return { open, opened, sent, closed: () => closed };
}

const found = {
  resolve: async () => ok({ path: '/helpers/taalcut-mac-helper', source: 'dev-build' as const }),
};
const missing = { resolve: async () => err(SidecarNotFound({ binary: 'taalcut-mac-helper' })) };

describe('the helper-backed decode service', () => {
  it('starts one helper per set of folders, decode alone, ended by stdin', async () => {
    const helpers = fakeHelpers();
    let roots = ['/frames', '/library', '/library'];
    const service = helperDecodeService({
      tasks: ['frames'],
      command: '/helpers/taalcut-mac-helper',
      roots: async () => roots,
      idleExitMs: 1000,
      open: helpers.open,
    });
    expect(service.tasks).toEqual(['frames']);
    expect((await service.pass(request)).ok).toBe(true);
    expect((await service.pass(request)).ok).toBe(true);
    expect(helpers.opened).toEqual([
      {
        command: '/helpers/taalcut-mac-helper',
        args: ['serve', '--services', 'decode', '--allow-root', '/frames', '--allow-root', '/library'],
        idleExitMs: 1000,
        holdsVideoSession: true,
      },
    ]);
    roots = ['/frames', '/library', '/other'];
    expect((await service.pass(request)).ok).toBe(true);
    expect(helpers.opened).toHaveLength(2);
    expect(helpers.sent).toEqual(['decode.pass', 'decode.pass', 'decode.pass']);
    await service.close();
    expect(helpers.closed()).toBe(2);
  });

  it('keeps a file a caller said to avoid on FFmpeg, with its reason', () => {
    const service = helperDecodeService({
      tasks: ['pass', 'frames'],
      command: '/helper',
      roots: async () => [],
    });
    service.avoid('/library/b.mov', 'decode.unsupported');
    expect(service.avoided('/library/b.mov')).toBe('decode.unsupported');
    expect(service.avoided('/library/c.mov')).toBeUndefined();
  });
});

describe('opening the decode service', () => {
  const open = async (setting: string | undefined, resolver: typeof found | typeof missing) => {
    const lines: string[] = [];
    let looked = 0;
    const counted = {
      resolve: () => {
        looked += 1;
        return resolver.resolve();
      },
    };
    const service = await openDecodeService({
      setting,
      resolver: counted,
      roots: async () => [],
      log: (l) => lines.push(l),
    });
    return { service, lines, looked };
  };

  it('opens the helper taking the setting’s tasks where one resolves', async () => {
    const unset = await open(undefined, found);
    expect(unset.service?.id).toBe('mac-helper');
    expect(unset.service?.tasks).toEqual(['pass', 'frames']);
    expect(unset.lines).toEqual([]);
    expect((await open('frames', found)).service?.tasks).toEqual(['frames']);
    const junk = await open('vt', found);
    expect(junk.service?.tasks).toEqual(['pass', 'frames']);
    expect(junk.lines).toEqual([
      '[media] decode service: TAALCUT_DECODE_SERVICE=vt is not one of off, frames, mac-helper: mac-helper, the default',
    ]);
  });

  it('opens none where no helper resolves (FFmpeg decodes everything), said once; none when off, without looking', async () => {
    const unset = await open(undefined, missing);
    expect(unset).toEqual({
      service: undefined,
      lines: ['[media] decode service: no mac helper (media.sidecar_not_found); FFmpeg decodes'],
      looked: 1,
    });
    expect(await open('off', found)).toEqual({ service: undefined, lines: [], looked: 0 });
  });
});
