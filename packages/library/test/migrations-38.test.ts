// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 38 (REF1, gate finding 8): stored reference links lose the sharer's tokens.
 * - Every version of a reference template keeps only what identifies its video, and nothing else in the document
 *   changes.
 * - A clean link, a link on another host and a format plan are left alone.
 * - The summary and the document read back clean.
 * Every link and token is made up.
 */
import { unwrap, type Template, type TemplateId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { createTemplateStore } from '../src/index';
import { referenceLinkAt38 } from '../src/migrations/0038-template-reference-links';
import { openTestDb, tempDir } from './helpers';
import { template } from './stores/documents';

const REEL = 'https://www.instagram.com/reel/EXAMPLE123/';
const SHARED = `${REEL}?utm_source=ig_web_copy_link&igsh=ZmFrZXRva2Vu&rpxt=FAKE&srtk=FAKE`;

const withLink = (url: string): Template => {
  const doc = template();
  if (doc.origin.kind !== 'reference') throw new Error('the test template is a reference');
  return { ...doc, origin: { ...doc.origin, url } };
};

describe('migration 38: reference links without share tokens', () => {
  it.each([
    [SHARED, REEL],
    ['https://instagram.com/reels/EXAMPLE123?igsh=ZmFrZQ==', REEL],
    ['https://www.instagram.com/some.creator/reel/EXAMPLE123/?igsh=ZmFrZQ', REEL],
    [
      'https://www.instagram.com/share/reel/FAKESHARE1/?igsh=ZmFrZQ',
      'https://www.instagram.com/share/reel/FAKESHARE1/',
    ],
    [
      'https://www.youtube.com/shorts/EXAMPLE1234?si=FAKE&feature=share',
      'https://www.youtube.com/shorts/EXAMPLE1234',
    ],
    ['https://youtu.be/EXAMPLE1234?si=FAKE', 'https://youtu.be/EXAMPLE1234'],
    [
      'https://www.youtube.com/watch?pp=FAKE&v=EXAMPLE1234&si=FAKE',
      'https://www.youtube.com/watch?v=EXAMPLE1234',
    ],
    [
      'https://www.tiktok.com/@someone/video/7300000000000000000?_r=1&_t=FAKE&is_from_webapp=1&sender_device=pc',
      'https://www.tiktok.com/@someone/video/7300000000000000000',
    ],
    ['https://example.com/reel?utm_source=x', null],
    ['not a link', null],
  ])('cleans %s', (stored, clean) => {
    expect(referenceLinkAt38(stored)).toBe(clean);
  });

  it('rewrites every stored version’s link, and nothing else', async () => {
    const db = openTestDb({ targetVersion: 37 });
    const store = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') });
    const shared = withLink(SHARED);
    unwrap(await store.create(shared, { name: 'Shared', projectId: null, listed: true }));
    unwrap(
      await store.addVersion(
        { ...shared, version: 2, parentVersion: 1 },
        { command: 'template.rename', source: 'ui', changeKey: 'k'.repeat(64) },
      ),
    );
    const clean = withLink(REEL);
    unwrap(await store.create(clean, { name: 'Clean', projectId: null, listed: true }));
    const elsewhere = withLink('https://example.com/reel?utm_source=x');
    unwrap(await store.create(elsewhere, { name: 'Elsewhere', projectId: null, listed: true }));
    const documents = () =>
      new Map(
        db.driver
          .prepare('SELECT template_id, version, document FROM template_versions')
          .all()
          .map((row) => [
            `${String(row.template_id)}@${String(row.version)}`,
            JSON.parse(String(row.document)),
          ]),
      );
    const before = documents();

    unwrap(db.migrateTo(38));
    const after = documents();
    for (const [key, doc] of before) {
      const url = key.startsWith(shared.id) ? REEL : doc.origin.url;
      expect(after.get(key), key).toEqual({ ...doc, origin: { ...doc.origin, url } });
    }
    const read = unwrap(await store.get(shared.id as TemplateId));
    expect((read.json as Template).origin).toMatchObject({ kind: 'reference', url: REEL });

    // Down leaves the links clean; up again changes nothing.
    unwrap(db.migrateTo(37));
    unwrap(db.migrateTo(38));
    expect(documents()).toEqual(after);
  });
});
