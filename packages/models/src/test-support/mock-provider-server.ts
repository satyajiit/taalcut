// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A local HTTP server that answers like OpenAI (/v1/responses,
 * /v1/chat/completions), Anthropic (/v1/messages) and Google
 * (/v1beta/models/<id>:streamGenerateContent), streaming real wire formats. pi-ai's own provider code talks to it through a base-URL override.
 * Replies come from a script queue; with nothing queued it says hello.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  anthropicMessages,
  chatCompletions,
  errorBody,
  geminiStream,
  openAIResponses,
  type MockReply,
} from './wire';

export type Route = 'openai' | 'anthropic' | 'chat' | 'gemini';

export type MockStep =
  | ({ readonly kind: 'reply' } & MockReply)
  | {
      readonly kind: 'error';
      readonly status: number;
      readonly message?: string;
      readonly headers?: Readonly<Record<string, string>>;
    }
  /** Sends the first delta, then stalls until the client disconnects (for cancellation). */
  | { readonly kind: 'stall' }
  /** Streams some text, then an "overloaded" error event (OpenAI route). */
  | { readonly kind: 'overload-mid-stream' }
  /**
   * Starts the stream, then closes the socket under it, as a dropped connection does: Node's fetch then fails the
   * read with "terminated". `afterText: false` drops it before any text has streamed.
   */
  | { readonly kind: 'drop-mid-stream'; readonly afterText?: boolean };

export interface RecordedRequest {
  readonly route: Route;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: Record<string, unknown>;
  readonly bytes: number;
}

export interface MockProviderServer {
  readonly url: string;
  /** Base URL for OpenAI-style providers (includes /v1). */
  readonly openaiBaseUrl: string;
  /** Base URL for Anthropic (the SDK appends /v1/messages). */
  readonly anthropicBaseUrl: string;
  /** Base URL for Google's Gemini API, as pi-ai's model metadata has it (includes /v1beta). */
  readonly geminiBaseUrl: string;
  readonly requests: RecordedRequest[];
  /** Queues the next replies for a route, in order. */
  script(route: Route, ...steps: MockStep[]): void;
  /** Unconsumed scripted steps, all routes. */
  pending(): number;
  /** Answer 401 when the check fails, like a provider that validates bearer tokens. */
  setAuthCheck(check: ((headers: IncomingMessage['headers']) => boolean) | undefined): void;
  close(): Promise<void>;
}

const ROUTES: Readonly<Record<string, Route>> = {
  '/v1/responses': 'openai',
  '/v1/messages': 'anthropic',
  '/v1/chat/completions': 'chat',
};

export async function startMockProviderServer(): Promise<MockProviderServer> {
  const queues: Record<Route, MockStep[]> = { openai: [], anthropic: [], chat: [], gemini: [] };
  const requests: RecordedRequest[] = [];
  let authCheck: ((headers: IncomingMessage['headers']) => boolean) | undefined;

  const server = createServer((req, res) => {
    void handle(req, res).catch((cause) => {
      res.statusCode = 500;
      res.end(String(cause));
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const gemini = /^\/v1beta\/models\/([^/:]+):streamGenerateContent$/.exec(path);
    const route = gemini ? 'gemini' : ROUTES[path];
    const raw = await readBody(req);
    if (!route || req.method !== 'POST') {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: `No route ${req.method} ${path}` } }));
      return;
    }
    const body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    requests.push({ route, path, headers: req.headers, body, bytes: raw.byteLength });
    const model = gemini?.[1] ?? (typeof body.model === 'string' ? body.model : 'mock-model');
    if (authCheck && !authCheck(req.headers)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify(errorBody(route, 401, 'Invalid or expired token.')));
      return;
    }
    const step = queues[route].shift() ?? { kind: 'reply', text: `Hello from the mock ${route} server.` };

    if (step.kind === 'error') {
      const message = step.message ?? `Mock error ${step.status}`;
      res.writeHead(step.status, { 'content-type': 'application/json', ...step.headers });
      res.end(JSON.stringify(errorBody(route, step.status, message)));
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    if (step.kind === 'stall') {
      const first = render(route, model, { text: 'Partial answer that never ends' });
      res.write(first.slice(0, 3).join(''));
      await new Promise<void>((resolve) => req.on('close', resolve));
      res.end();
      return;
    }
    if (step.kind === 'drop-mid-stream') {
      const events = render(route, model, { text: 'Half an answer' });
      res.write(events.slice(0, step.afterText === false ? 1 : 3).join(''));
      // Let the bytes leave before the socket goes, so the client is reading the body when it does.
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      res.socket?.destroy();
      return;
    }
    if (step.kind === 'overload-mid-stream') {
      res.write(render(route, model, { text: 'Half an answer' }).slice(0, 3).join(''));
      res.end(
        `event: error\ndata: ${JSON.stringify({ type: 'error', code: 'server_error', message: 'The server is overloaded' })}\n\n`,
      );
      return;
    }
    for (const event of render(route, model, step)) res.write(event);
    res.end();
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    openaiBaseUrl: `${url}/v1`,
    anthropicBaseUrl: url,
    geminiBaseUrl: `${url}/v1beta`,
    requests,
    script: (route, ...steps) => void queues[route].push(...steps),
    pending: () => Object.values(queues).reduce((sum, queue) => sum + queue.length, 0),
    setAuthCheck: (check) => {
      authCheck = check;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function render(route: Route, model: string, reply: MockReply): string[] {
  if (route === 'openai') return openAIResponses(model, reply);
  if (route === 'anthropic') return anthropicMessages(model, reply);
  if (route === 'gemini') return geminiStream(model, reply);
  return chatCompletions(model, reply);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  return Buffer.concat(parts);
}
