// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId, stagedImportSchema, type StagedImport } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import { startFixture, type Fixture } from './support/harness';
import { jpegBytes, pairPhone, tokenOf, uploadAll } from './support/upload';

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

describe('import hand-off', () => {
  let fx: Fixture | undefined;

  afterEach(async () => {
    await fx?.dispose();
    fx = undefined;
  });

  it('imports a finished file and records a likely re-encode on the journal first', async () => {
    let seen: StagedImport | undefined;
    fx = await startFixture({
      probe: async () => ({ videoCodec: 'h264', audioCodec: 'aac' }),
      importStaged: async (file) => {
        const journal = JSON.parse(await readFile(join(file.path + '.import.json'), 'utf8')) as unknown;
        seen = stagedImportSchema.parse(journal);
        return {
          ok: true,
          value: { assetId: newId<'Asset'>(), sourceId: newId<'Source'>(), duplicate: 'none' },
        };
      },
    });
    await send(fx, 'clip.mov');
    await fx.service.drained();
    expect(seen?.reencode.verdict).toBe('likely');
    expect(seen?.companions).toEqual([join(fx.staging, `${seen?.uploadId}.json`)]);
    const imported = await fx.waitFor((item) => item.type === 'file' && item.file.state === 'imported');
    expect(imported.type === 'file' && imported.file.reencode?.verdict).toBe('likely');
  });

  it('marks a library duplicate and retries a retryable failure', async () => {
    let calls = 0;
    fx = await startFixture({
      importStaged: async () => {
        calls += 1;
        if (calls < 3) {
          return {
            ok: false,
            error: {
              code: 'transfer.import_failed',
              messageKey: 'errors.transfer.import_failed',
              retryable: true,
            },
          };
        }
        return {
          ok: true,
          value: {
            assetId: newId<'Asset'>(),
            sourceId: newId<'Source'>(),
            duplicate: 'already-in-library' as const,
          },
        };
      },
    });
    await send(fx, 'again.mov');
    await fx.service.drained();
    expect(calls).toBe(3);
    const duplicate = await fx.waitFor((item) => item.type === 'file' && item.file.state === 'duplicate');
    expect(duplicate.type === 'file' && duplicate.file.state).toBe('duplicate');
  });

  it('keeps the journal when the import fails for good', async () => {
    fx = await startFixture({
      importStaged: async (file) => {
        const journal = join(fx!.staging, `${file.uploadId}.import.json`);
        await readFile(journal);
        return {
          ok: false,
          error: {
            code: 'transfer.import_failed',
            messageKey: 'errors.transfer.import_failed',
            retryable: false,
          },
        };
      },
    });
    const url = await send(fx, 'bad.mov');
    await fx.service.drained();
    const id = new URL(url).pathname.split('/').pop() ?? '';
    const journal = stagedImportSchema.parse(
      JSON.parse(await readFile(join(fx.staging, `${id}.import.json`), 'utf8')),
    );
    expect(journal.uploadId).toBe(id);
    expect(fx.items.some((item) => item.type === 'file' && item.file.state === 'failed')).toBe(true);
  });
});

async function send(fx: Fixture, name: string): Promise<string> {
  const paired = await pairPhone(fx, { token: tokenOf(fx.pairing.qrText), pin: fx.pairing.pin }, IOS);
  expect(paired.status).toBe(200);
  return uploadAll({
    fx,
    credential: paired.credential,
    data: jpegBytes(),
    name,
    type: 'image/jpeg',
    chunkSize: 1024,
    lastModified: fx.clock.now() - 30_000,
  });
}
