// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

const MAX_BYTES = 4 * 1024 * 1024;

/** Count framing bytes directly so split UTF-8 characters never change the byte limit. */
function responseCounter(sse: boolean) {
  let bytes = 0;
  let lineBytes = 0;
  let afterCr = false;
  const lineEnd = () => {
    if (lineBytes === 0) bytes = 0;
    lineBytes = 0;
  };
  const increment = () => {
    if (++bytes > MAX_BYTES) throw new Error('Plugin event exceeds the byte limit.');
  };
  return (chunk: Uint8Array) => {
    if (!sse) {
      bytes += chunk.byteLength;
      if (bytes > MAX_BYTES) throw new Error('Plugin response exceeds the byte limit.');
      return;
    }
    for (const byte of chunk) {
      // CRLF is one newline, including when its bytes arrive in different chunks.
      if (afterCr) {
        afterCr = false;
        if (byte === 10) {
          increment();
          lineEnd();
          continue;
        }
        lineEnd();
      }
      increment();
      if (byte === 13) afterCr = true;
      else if (byte === 10) lineEnd();
      else lineBytes += 1;
    }
  };
}

/** Bound JSON bodies and individual SSE events before the SDK buffers or parses them. */
export function boundedPluginResponse(response: Response, signal?: AbortSignal): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  const count = responseCounter(contentType === 'text/event-stream');
  let settled = false;
  let abort: (() => void) | undefined;
  const cleanup = () => {
    settled = true;
    if (abort) signal?.removeEventListener('abort', abort);
  };
  const cancel = async (reason: unknown) => {
    await reader.cancel(reason).catch(() => undefined);
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => {
        if (settled) return;
        cleanup();
        const reason = signal?.reason ?? new Error('Plugin response cancelled.');
        controller.error(reason);
        void cancel(reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    },
    async pull(controller) {
      if (settled) return;
      try {
        const next = await reader.read();
        if (settled) return;
        if (next.done) {
          cleanup();
          controller.close();
          return;
        }
        count(next.value);
        controller.enqueue(next.value);
      } catch (error) {
        if (settled) return;
        cleanup();
        controller.error(error);
        await cancel(error);
      }
    },
    async cancel(reason) {
      cleanup();
      await cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
