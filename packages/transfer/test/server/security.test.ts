// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isBindableAddress } from '../../src/network';
import { TRANSFER_LIMITS } from '../../src/limits';
import { httpCall, startFixture, type Fixture } from '../support/harness';
import { beginUpload, jpegBytes, pairPhone, tokenOf } from '../support/upload';

describe('transfer security', () => {
  let fx: Fixture | undefined;

  afterEach(async () => {
    await fx?.dispose();
    fx = undefined;
  });

  it('checks Host, Origin and Sec-Fetch-Site, and serves the page with locked headers', async () => {
    fx = await startFixture();
    const page = await httpCall({ host: fx.address, port: fx.port, path: '/' });
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    const wrongHost = await httpCall({
      host: fx.address,
      port: fx.port,
      path: '/api/ping',
      headers: { host: 'evil.example:80' },
    });
    expect(wrongHost.status).toBe(421);
    const wrongOrigin = await httpCall({
      host: fx.address,
      port: fx.port,
      path: '/api/ping',
      headers: { origin: 'http://evil.example' },
    });
    expect(wrongOrigin.status).toBe(403);
    const crossSite = await httpCall({
      host: fx.address,
      port: fx.port,
      path: '/api/ping',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(crossSite.status).toBe(403);
  });

  it('refuses asset traversal, upload downloads and a missing credential', async () => {
    fx = await startFixture();
    const traversal = await httpCall({
      host: fx.address,
      port: fx.port,
      path: '/assets/%2e%2e%2fpackage.json',
    });
    expect(traversal.status).toBe(404);
    const download = await httpCall({ host: fx.address, port: fx.port, path: '/files' });
    expect(download.status).toBe(404);
    expect(download.body).toBe('');
    const session = await httpCall({ host: fx.address, port: fx.port, path: '/api/session' });
    expect(session.status).toBe(401);
    expect(session.body).toBe('');
  });

  it('refuses an oversized JSON body, a huge header and an oversized upload', async () => {
    fx = await startFixture();
    const credential = (await pairPhone(fx, { token: tokenOf(fx.pairing.qrText), pin: fx.pairing.pin }))
      .credential;
    const bulky = await httpCall({
      host: fx.address,
      port: fx.port,
      method: 'POST',
      path: '/api/pair',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'x', pin: '000000', pad: 'y'.repeat(TRANSFER_LIMITS.maxJsonBytes) }),
    });
    expect(bulky.status).toBe(413);
    await expect(
      httpCall({
        host: fx.address,
        port: fx.port,
        path: '/api/ping',
        headers: { 'x-pad': 'z'.repeat(TRANSFER_LIMITS.maxHeaderBytes) },
      }),
    ).rejects.toThrow();
    const oversize = await httpCall({
      host: fx.address,
      port: fx.port,
      method: 'POST',
      path: '/files',
      headers: {
        authorization: `Bearer ${credential}`,
        'tus-resumable': '1.0.0',
        'upload-length': String(TRANSFER_LIMITS.maxFileBytes + 1),
        'upload-metadata': meta({
          filename: 'a.mov',
          filetype: 'video/quicktime',
          lastModified: '1',
          fingerprint: 'a',
        }),
        'content-length': '0',
      },
    });
    expect(oversize.status).toBe(413);
  });

  it('rejects bytes that are not media and a name that tries to be a path', async () => {
    fx = await startFixture();
    const credential = (await pairPhone(fx, { token: tokenOf(fx.pairing.qrText), pin: fx.pairing.pin }))
      .credential;
    const text = Buffer.from('this is not a video'.padEnd(32, '!'));
    const refused = beginUpload({
      fx,
      credential,
      data: text,
      name: 'notes.txt',
      type: 'text/plain',
      chunkSize: 1024,
    });
    await expect(refused.done).rejects.toThrow(/415/);
    const sneaky = '../../etc/passwd';
    const url = await new Promise<string>((resolve, reject) => {
      const started = beginUpload({
        fx: fx!,
        credential,
        data: jpegBytes(),
        name: sneaky,
        type: 'image/jpeg',
        chunkSize: 1024,
      });
      started.done.then(() => resolve(started.upload.url ?? ''), reject);
    });
    expect(url).toContain('/files/');
    const names = await tree(fx.staging);
    expect(names.some((name) => name.includes('passwd') || name.includes('..'))).toBe(false);
    expect(fx.logs.join('\n')).not.toContain(sneaky);
    const full = await startFixture({ diskFree: async () => 100 });
    try {
      const cred = (await pairPhone(full, { token: tokenOf(full.pairing.qrText), pin: full.pairing.pin }))
        .credential;
      const disk = await httpCall({
        host: full.address,
        port: full.port,
        method: 'POST',
        path: '/files',
        headers: {
          authorization: `Bearer ${cred}`,
          'tus-resumable': '1.0.0',
          'upload-length': '1000',
          'upload-metadata': meta({
            filename: 'a.jpg',
            filetype: 'image/jpeg',
            lastModified: '1',
            fingerprint: 'b',
          }),
          'content-length': '0',
        },
      });
      expect(disk.status).toBe(507);
    } finally {
      await full.dispose();
    }
  });

  it('never treats a public address or 0.0.0.0 as bindable', () => {
    expect(isBindableAddress('0.0.0.0')).toBe(false);
    expect(isBindableAddress('8.8.8.8')).toBe(false);
    expect(isBindableAddress('::1')).toBe(false);
    expect(isBindableAddress('192.168.1.20')).toBe(true);
    expect(isBindableAddress('127.0.0.1')).toBe(false);
    expect(isBindableAddress('127.0.0.1', true)).toBe(true);
  });
});

function meta(entries: Record<string, string>): string {
  return Object.entries(entries)
    .map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`)
    .join(',');
}

async function tree(dir: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    found.push(entry.name);
    if (entry.isDirectory()) found.push(...(await tree(join(dir, entry.name))));
  }
  return found;
}
