// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A phone, as far as the Wi-Fi hand-off sees one (P2-L3): it pairs with the
 * short address's setup code and the PIN, then uploads a file with tus 1.0
 * (creation, then PATCHes of 4 MiB from offset 0), as the phone page's tus
 * client does. Plain fetch, so the e2e needs no tus dependency.
 */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const CHUNK = 4 * 1024 * 1024;

export async function pairPhone(base: string, code: string, pin: string): Promise<string> {
  const response = await fetch(`${base}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': IPHONE },
    body: JSON.stringify({ code, pin, device: { name: 'e2e phone' } }),
  });
  const body = (await response.json().catch(() => ({}))) as { credential?: string };
  if (!response.ok || !body.credential) throw new Error(`pairing refused: HTTP ${response.status}`);
  return body.credential;
}

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');

/** Uploads `path` under its own name; resolves when the server has every byte. */
export async function uploadFile(
  base: string,
  credential: string,
  path: string,
  type: string,
): Promise<void> {
  const name = basename(path);
  const size = statSync(path).size;
  const lastModified = Math.trunc(statSync(path).mtimeMs);
  const fingerprint = `${name}\n${size}\n${lastModified}\n${type}`;
  const auth = { authorization: `Bearer ${credential}`, 'tus-resumable': '1.0.0', 'user-agent': IPHONE };
  const created = await fetch(`${base}/files`, {
    method: 'POST',
    headers: {
      ...auth,
      'upload-length': String(size),
      'upload-metadata': [
        `filename ${b64(name)}`,
        `filetype ${b64(type)}`,
        `lastModified ${b64(String(lastModified))}`,
        `fingerprint ${b64(fingerprint)}`,
      ].join(','),
    },
  });
  const location = created.headers.get('location');
  if (created.status !== 201 || !location) throw new Error(`upload not created: HTTP ${created.status}`);
  const target = new URL(location, base).href;
  const bytes = readFileSync(path);
  for (let offset = 0; offset < size; offset += CHUNK) {
    const chunk = bytes.subarray(offset, Math.min(size, offset + CHUNK));
    const patched = await fetch(target, {
      method: 'PATCH',
      headers: {
        ...auth,
        'upload-offset': String(offset),
        'content-type': 'application/offset+octet-stream',
      },
      body: chunk,
    });
    if (patched.status !== 204) throw new Error(`chunk at ${offset} refused: HTTP ${patched.status}`);
  }
}
