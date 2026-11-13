// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Between Node's HTTP objects and the SDK's fetch-style handler: the body read with a size cap, the request the
 * SDK sees (only the headers it reads, so the bearer never goes past the pipeline, and aborted when the client
 * goes away), and the SDK's response streamed back.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MCP_PATH } from './http-guard';

/** Headers the SDK reads; nothing else (the bearer least of all) goes past the pipeline. */
const FORWARDED = ['content-type', 'accept', 'mcp-protocol-version', 'mcp-method', 'mcp-name'];

export function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The body as text, or undefined once more than `max` bytes arrived (the rest is left to the refusal's linger). */
export function readBody(req: IncomingMessage, max: number): Promise<string | undefined> {
  return new Promise((resolve, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const done = (): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size <= max) return void chunks.push(buffer);
      done();
      resolve(undefined);
    };
    const onEnd = (): void => {
      done();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onError = (cause: Error): void => {
      done();
      fail(cause);
    };
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
  });
}

/** The request the SDK handles: the body already read, the forwarded headers, aborted if the client goes away. */
export function sdkRequest(req: IncomingMessage, res: ServerResponse, port: number, text: string): Request {
  const controller = new AbortController();
  res.once('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = single(req.headers[name]);
    if (value !== undefined) headers.set(name, value);
  }
  return new Request(`http://127.0.0.1:${port}${MCP_PATH}`, {
    method: 'POST',
    headers,
    body: text,
    signal: controller.signal,
  });
}

export async function writeResponse(
  res: ServerResponse,
  response: Response,
  extra: Record<string, string>,
): Promise<void> {
  const headers: Record<string, string> = { ...extra };
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.flushHeaders();
  if (response.body) {
    for await (const chunk of response.body) {
      if (res.destroyed) break;
      res.write(chunk);
    }
  }
  res.end();
}
