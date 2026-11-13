// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  callRpc,
  CancelledError,
  err,
  GeneratedAssetSinkToken,
  ok,
  toTaalcutError,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type Container,
} from '@taalcut/core';
import { HEADLESS_SHELL, resolveHeadlessShell } from '@taalcut/render';
import type { CreationCapture } from '@taalcut/tools';
import puppeteer, { type Browser, type HTTPRequest, type Page } from 'puppeteer-core';
import { z } from 'zod';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { AgentMainServicesToken } from '../../shared/tokens';
import { installedShellDir } from '../roots/render-jobs';
import { fetchCreationResource } from './network';

export async function creationBrowserPath(
  container: Container,
  config: UtilityConfig,
  signal: AbortSignal,
): AsyncResult<string> {
  const find = () =>
    resolveHeadlessShell({
      componentDir: installedShellDir(config.userData),
      development: !config.packaged,
      packageDir: config.packaged
        ? config.resourcesPath
        : dirname(dirname(createRequire(import.meta.url).resolve('@taalcut/render'))),
      ...(!config.packaged && process.env.TAALCUT_HEADLESS_SHELL
        ? { explicit: process.env.TAALCUT_HEADLESS_SHELL }
        : {}),
    });
  const found = find();
  if (found.ok || !container.has(AgentMainServicesToken)) return found;
  const installed = await callRpc(
    container
      .resolve(AgentMainServicesToken)()
      .components.install({ id: HEADLESS_SHELL.componentId }, { signal }),
  );
  return installed.ok ? find() : installed;
}

/** Every capture uses an owned temporary profile, with no connection to the person's browsing session. */
export async function withCreationPage<T>(
  executablePath: string,
  signal: AbortSignal,
  work: (page: Page) => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw new Error('Capture cancelled');
  const profile = await mkdtemp(join(tmpdir(), 'taalcut-capture-'));
  let browser: Browser | undefined;
  const stop = () => {
    void browser?.close().catch(() => undefined);
  };
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      userDataDir: profile,
      ignoreDefaultArgs: ['--disable-popup-blocking'],
      args: ['--disable-background-networking', '--disable-extensions', '--disable-sync', '--no-first-run'],
    });
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) throw new Error('Capture cancelled');
    const page = await browser.newPage();
    await page.setBypassServiceWorker(true);
    page.on('popup', (popup) => {
      void popup?.close();
    });
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.setDefaultNavigationTimeout(30_000);
    page.setDefaultTimeout(15_000);
    return await work(page);
  } finally {
    signal.removeEventListener('abort', stop);
    await browser?.close().catch(() => undefined);
    await rm(profile, { recursive: true, force: true });
  }
}

const CAPTURE_CSP =
  "default-src 'none'; script-src http: https: blob: 'unsafe-inline' 'unsafe-eval'; style-src http: https: 'unsafe-inline'; img-src http: https: data: blob:; font-src http: https: data:; media-src http: https: blob:; connect-src http: https:; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'";

/** Bound in-flight bytes too: a page cannot start two hundred large downloads at the same instant. */
function captureRequests(page: Page, signal: AbortSignal, localOrigin?: string) {
  let active = 0;
  let requests = 0;
  let totalBytes = 0;
  const waiting: (() => void)[] = [];
  const totalLimit = 64 * 1024 * 1024;
  async function respond(request: HTTPRequest) {
    if (active >= 8) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      if (signal.aborted || totalBytes >= totalLimit) return await request.abort();
      const result = await fetchCreationResource(request.url(), {
        signal,
        maxBytes: Math.min(8 * 1024 * 1024, totalLimit - totalBytes),
        ...(localOrigin ? { localOrigin } : {}),
      });
      if (!result.ok || totalBytes + result.value.bytes.byteLength > totalLimit) return await request.abort();
      totalBytes += result.value.bytes.byteLength;
      // Let the browser adopt the final resource URL so relative CSS/font imports resolve against it.
      if (result.value.url !== request.url())
        return await request.respond({ status: 302, headers: { location: result.value.url } });
      await request.respond({
        status: 200,
        contentType: result.value.contentType,
        headers: { 'access-control-allow-origin': '*', 'content-security-policy': CAPTURE_CSP },
        body: result.value.bytes,
      });
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }
  page.on('request', (request) => {
    const run =
      ++requests > 200 || request.method() !== 'GET'
        ? request.abort()
        : request.url().startsWith('data:')
          ? request.continue()
          : respond(request);
    void run.catch(() => {
      if (!request.isInterceptResolutionHandled()) void request.abort().catch(() => undefined);
    });
  });
}

export async function keepCreationImage(
  container: Container,
  bytes: Uint8Array,
  label: string,
  mediaType: 'image/png' | 'image/jpeg' = 'image/png',
): AsyncResult<AssetId> {
  const digest = createHash('sha256').update(bytes).digest('hex');
  const kept = await container.resolve(GeneratedAssetSinkToken).put({
    bytes,
    mediaType,
    fileName: `capture-${digest.slice(0, 16)}.${mediaType === 'image/png' ? 'png' : 'jpg'}`,
    projectId: null,
    provenance: {
      kind: 'generated',
      generation: 'workspace',
      provider: 'taalcut',
      model: label,
      access: 'local',
      quality: null,
      promptSha256: digest,
      voiceId: null,
      providerRef: null,
      c2pa: 'absent',
      costUsd: 0,
      runId: null,
      createdAt: Date.now(),
    },
  });
  return kept.ok ? ok(kept.value.assetId) : kept;
}

export async function captureCreationUrl(
  container: Container,
  config: UtilityConfig,
  raw: string,
  signal: AbortSignal,
  options: { readonly localOrigin?: string } = {},
): AsyncResult<CreationCapture> {
  const session = new AbortController();
  const scopedSignal = AbortSignal.any([signal, session.signal]);
  try {
    const requested = new URL(raw);
    const localOrigin = options.localOrigin;
    const probe = await fetchCreationResource(raw, {
      signal: scopedSignal,
      maxBytes: 8 * 1024 * 1024,
      ...(localOrigin ? { localOrigin } : {}),
    });
    if (!probe.ok) return probe;
    const executable = await creationBrowserPath(container, config, scopedSignal);
    if (!executable.ok) return executable;
    return await withCreationPage(executable.value, scopedSignal, async (page) => {
      await page.setRequestInterception(true);
      captureRequests(page, scopedSignal, localOrigin);
      await page.goto(probe.value.url, { waitUntil: 'networkidle2' });
      await page.evaluate('document.fonts.ready');
      await page.evaluate(`Promise.race([
        Promise.all([...document.images].filter(image => {
          const box = image.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight;
        }).map(image => image.decode().catch(() => undefined))),
        new Promise(resolve => setTimeout(resolve, 5000))
      ])`);
      const captured = await page.evaluate(`(() => ({
        title: document.title,
        text: document.body.innerText.slice(0, 80_000),
        colors: [...new Set([...document.querySelectorAll('h1,h2,button,a')].slice(0, 60)
          .map((element) => getComputedStyle(element).color))],
        fonts: [...new Set([...document.querySelectorAll('h1,h2,p,button')].slice(0, 60)
          .map((element) => getComputedStyle(element).fontFamily))],
        controls: [...document.querySelectorAll('button,a,input')].slice(0, 80).map((element) => ({
          tag: element.tagName, label: element.textContent?.trim().slice(0, 100) ?? '',
          id: element.id, role: element.getAttribute('role'),
        })),
      }))()`);
      const extracted = z
        .object({
          title: z.string(),
          text: z.string(),
          colors: z.array(z.string()),
          fonts: z.array(z.string()),
          controls: z.array(
            z.object({ tag: z.string(), label: z.string(), id: z.string(), role: z.string().nullable() }),
          ),
        })
        .parse(captured);
      if (extracted.text.trim().length < 20)
        return err(
          ValidationError(
            { field: 'url' },
            { detail: 'Capture has no readable product content; provide a screenshot or running URL' },
          ),
        );
      const image = await keepCreationImage(
        container,
        await page.screenshot({ type: 'png' }),
        'browser-capture',
      );
      if (!image.ok) return image;
      return ok({
        title: extracted.title || requested.hostname,
        url: raw,
        text: `${extracted.text}\n\nBrand and controls: ${JSON.stringify({ colors: extracted.colors, fonts: extracted.fonts, controls: extracted.controls })}`,
        assets: [{ assetId: image.value, mimeType: 'image/png', label: extracted.title || 'Page' }],
        evidence: [raw],
      });
    });
  } catch (cause) {
    return signal.aborted ? err(CancelledError()) : err(toTaalcutError(cause));
  } finally {
    session.abort();
  }
}
