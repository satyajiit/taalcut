// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import { boundedPluginResponse } from '../../src/plugins/bounded-response';

const LIMIT = 4 * 1024 * 1024;
const encoder = new TextEncoder();

function source(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const cancelled = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      // Keep the source open so a rejection must actively cancel upstream.
    },
    cancel: cancelled,
  });
  return { response: new Response(body, { headers }), cancelled };
}

function complete(bytes: Uint8Array, headers: Record<string, string>, chunkSize = 65_536) {
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) return controller.close();
        const next = Math.min(offset + chunkSize, bytes.length);
        controller.enqueue(bytes.subarray(offset, next));
        offset = next;
      },
    }),
    { headers },
  );
}

async function drain(response: Response) {
  const reader = response.body!.getReader();
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) return size;
    size += next.value.byteLength;
  }
}

describe('bounded plugin transport responses', () => {
  it.each<Record<string, string>>([{}, { 'content-length': '1' }])(
    'caps actual JSON bytes despite headers %j',
    async (headers) => {
      const upstream = source([new Uint8Array(LIMIT), new Uint8Array(1)], headers);
      await expect(drain(boundedPluginResponse(upstream.response))).rejects.toThrow('byte limit');
      expect(upstream.cancelled).toHaveBeenCalledOnce();
    },
  );

  it('accepts exactly the JSON limit and preserves status and headers', async () => {
    const raw = new Response(new Uint8Array(LIMIT), {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'application/json', 'mcp-session-id': 'session' },
    });
    const bounded = boundedPluginResponse(raw);
    expect(bounded.status).toBe(201);
    expect(bounded.statusText).toBe('Created');
    expect(bounded.headers.get('mcp-session-id')).toBe('session');
    expect(await drain(bounded)).toBe(LIMIT);
  });

  it.each(['\n', '\r\n', '\r'])('allows many bounded SSE events with %j newlines', async (newline) => {
    const event = encoder.encode(`data: ${'x'.repeat(LIMIT / 2)}${newline}${newline}`);
    const bytes = new Uint8Array(event.length * 3);
    for (let index = 0; index < 3; index++) bytes.set(event, event.length * index);
    const raw = complete(bytes, { 'content-type': 'Text/Event-Stream; charset=utf-8' });
    expect(await drain(boundedPluginResponse(raw))).toBe(bytes.length);
  });

  it('bounds a whole multiline SSE event, not each data line', async () => {
    const line = encoder.encode(`data: ${'x'.repeat(LIMIT / 2)}\n`);
    const upstream = source([line, line], { 'content-type': 'text/event-stream' });
    await expect(drain(boundedPluginResponse(upstream.response))).rejects.toThrow('byte limit');
    expect(upstream.cancelled).toHaveBeenCalledOnce();
  });

  it('handles split UTF-8 and split CRLF without modifying any bytes', async () => {
    const text = 'data: café 💡\r\n\r\ndata: हिन्दी\r\n\r\n';
    const raw = complete(encoder.encode(text), { 'content-type': 'text/event-stream' }, 1);
    expect(await boundedPluginResponse(raw).text()).toBe(text);
  });

  it('counts UTF-8 bytes rather than characters', async () => {
    const bytes = encoder.encode(`data: ${'💡'.repeat(LIMIT / 4)}\n\n`);
    const upstream = source([bytes], { 'content-type': 'text/event-stream' });
    await expect(drain(boundedPluginResponse(upstream.response))).rejects.toThrow('byte limit');
    expect(upstream.cancelled).toHaveBeenCalledOnce();
  });

  it('includes both bytes of a final CRLF in the event limit', async () => {
    const bytes = encoder.encode(`${'x'.repeat(LIMIT - 3)}\r\n\r\n`);
    const upstream = source([bytes.subarray(0, LIMIT), bytes.subarray(LIMIT)], {
      'content-type': 'text/event-stream',
    });
    await expect(drain(boundedPluginResponse(upstream.response))).rejects.toThrow('byte limit');
    expect(upstream.cancelled).toHaveBeenCalledOnce();
  });

  it('cancels upstream when the consumer cancels', async () => {
    const upstream = source([encoder.encode('data: partial')], { 'content-type': 'text/event-stream' });
    const reader = boundedPluginResponse(upstream.response).body!.getReader();
    await reader.read();
    await reader.cancel('done');
    expect(upstream.cancelled).toHaveBeenCalledWith('done');
  });

  it.each([false, true])(
    'cancels pending reads for an aborted signal (already aborted: %s)',
    async (already) => {
      const upstream = source([]);
      const controller = new AbortController();
      if (already) controller.abort();
      const pending = boundedPluginResponse(upstream.response, controller.signal).text();
      if (!already) controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(upstream.cancelled).toHaveBeenCalledOnce();
    },
  );

  it('preserves bodyless responses', () => {
    const response = new Response(null, { status: 204 });
    expect(boundedPluginResponse(response)).toBe(response);
  });
});
