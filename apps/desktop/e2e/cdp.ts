// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A minimal Chrome DevTools Protocol client for the packaged-app test.
 * Playwright's connectOverCDP stalls on Electron (it calls browser-level
 * methods Electron doesn't implement), and only Runtime.evaluate on the page
 * target is needed here.
 */
import { type Evaluator } from './renderer-probes';

interface TargetInfo {
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

export interface CdpPage extends Evaluator {
  readonly url: string;
  close(): void;
}

/**
 * Waits for a page target whose URL starts with `urlPrefix`, connects to it,
 * and waits until that document has loaded: the target lists the URL it is
 * navigating to before the document (and its preload) exists.
 */
export async function connectToPage(port: number, urlPrefix: string, timeoutMs = 15_000): Promise<CdpPage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as TargetInfo[];
    const target = targets.find((t) => t.type === 'page' && t.url.startsWith(urlPrefix));
    if (target) {
      const page = await open(target);
      await loaded(page, urlPrefix, deadline);
      return page;
    }
    if (Date.now() > deadline)
      throw new Error(`no page at ${urlPrefix}; targets: ${JSON.stringify(targets)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function loaded(page: CdpPage, urlPrefix: string, deadline: number): Promise<void> {
  for (;;) {
    const ready = await page
      .evaluate((prefix) => location.href.startsWith(prefix) && document.readyState === 'complete', urlPrefix)
      .catch(() => false);
    if (ready) return;
    if (Date.now() > deadline) throw new Error(`the page at ${urlPrefix} never finished loading`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function open(target: TargetInfo): Promise<CdpPage> {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
  });
  const waiting = new Map<number, (message: CdpResponse) => void>();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as CdpResponse;
    if (message.id !== undefined) waiting.get(message.id)?.(message);
  });
  let nextId = 1;

  const send = (method: string, params: object) =>
    new Promise<CdpResponse>((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });

  return {
    url: target.url,
    async evaluate(fn, arg) {
      const response = await send('Runtime.evaluate', {
        expression: `(${fn.toString()})(${JSON.stringify(arg)})`,
        awaitPromise: true,
        returnByValue: true,
      });
      const result = response.result;
      if (response.error || result?.exceptionDetails) {
        throw new Error(`evaluate failed: ${JSON.stringify(response.error ?? result?.exceptionDetails)}`);
      }
      return result?.result.value as never;
    },
    close: () => socket.close(),
  };
}

interface CdpResponse {
  readonly id?: number;
  readonly error?: unknown;
  readonly result?: { result: { value?: unknown }; exceptionDetails?: unknown };
}
