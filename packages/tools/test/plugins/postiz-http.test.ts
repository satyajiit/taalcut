// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ReadableStream } from 'node:stream/web';
import { describe, expect, it, vi } from 'vitest';
import { callPostizApi } from '../../src/plugins/postiz-http';
import { postizOperations } from '../../src/plugins/postiz-operations';
import { pluginAttempt } from '../../src/plugins/safe-result';

const operation = (name: string) => postizOperations().find((item) => item.name === name)!;
const signal = () => AbortSignal.timeout(3_000);
function options(response: Response) {
  return {
    baseUrl: 'https://api.postiz.com/public/v1',
    apiKey: 'secret',
    fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
  };
}

describe('Postiz HTTP boundaries', () => {
  it('rejects malformed success JSON and accepts empty deletion responses', async () => {
    expect(
      (await callPostizApi(operation('listGroups'), {}, options(new Response('<html>')), signal())).ok,
    ).toBe(false);
    expect(
      await callPostizApi(
        operation('deletePost'),
        { id: 'post' },
        options(new Response(null, { status: 204 })),
        signal(),
      ),
    ).toEqual({ ok: true, value: null });
  });

  it('limits streamed response bytes even when Content-Length lies', async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4_000_001));
      },
      cancel: cancelled,
    });
    const result = await callPostizApi(
      operation('listGroups'),
      {},
      options(new Response(body, { headers: { 'content-length': '1' } })),
      signal(),
    );
    expect(result.ok).toBe(false);
    expect(cancelled).toHaveBeenCalled();
  });

  it('cancels unconsumed HTTP error bodies', async () => {
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream({ cancel: cancelled }), { status: 403 });
    const result = await callPostizApi(operation('listGroups'), {}, options(response), signal());
    expect(result).toMatchObject({ ok: false, error: { code: 'tools.plugin_authentication_failed' } });
    expect(cancelled).toHaveBeenCalled();
  });

  it('does not upload without a resolver or with both media identifiers', async () => {
    const opts = options(Response.json({}));
    const assetId = '01J00000000000000000000000';
    expect((await callPostizApi(operation('uploadFile'), { assetId }, opts, signal())).ok).toBe(false);
    expect(
      (await callPostizApi(operation('uploadFile'), { assetId, renderId: assetId }, opts, signal())).ok,
    ).toBe(false);
    expect(opts.fetch).not.toHaveBeenCalled();
  });

  it('rejects scheduled posts with no targets before network access', async () => {
    const opts = options(Response.json({}));
    const result = await callPostizApi(
      operation('createPost'),
      {
        type: 'schedule',
        date: '2026-12-01T12:00:00Z',
        tags: [],
        shortLink: false,
      },
      opts,
      signal(),
    );
    expect(result.ok).toBe(false);
    expect(opts.fetch).not.toHaveBeenCalled();
  });

  it('distinguishes deadline expiration from caller cancellation', async () => {
    const aborted = new AbortController();
    aborted.abort();
    expect(
      await pluginAttempt('postiz', aborted.signal, async () => {
        throw new Error('not reached');
      }),
    ).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    const timed = AbortSignal.timeout(1);
    expect(await pluginAttempt('postiz', timed, () => new Promise<never>(() => {}))).toMatchObject({
      ok: false,
      error: { code: 'core.timeout' },
    });
  });
});
