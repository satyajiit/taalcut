// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  adoptRemote,
  applyRemote,
  ghostFor,
  ghostItem,
  isActive,
  newItem,
  reasonKeyFor,
  restoreItems,
  snapshotOf,
  summarize,
  uploadIdFromUrl,
  // @ts-expect-error phone modules ship as plain JavaScript for the browser.
} from '../../phone/queue.mjs';

type Item = Record<string, unknown> & { state: string; file: unknown; record: { name: string; size: number } };
const file = (name: string, size: number) => ({ name, size, lastModified: 1_700_000_000_000, type: 'video/quicktime' });
const item = (id: number, state: string, extra: Partial<Item> = {}): Item =>
  Object.assign(newItem(id, file(`clip-${id}.mov`, 1_000)), { state }, extra) as Item;

describe('what a row offers', () => {
  it('lets you pause and stop a file that is sending, stop or resume one that is paused', () => {
    expect(actionsFor(item(1, 'waiting'))).toEqual(['remove']);
    expect(actionsFor(item(1, 'sending'))).toEqual(['pause', 'stop']);
    expect(actionsFor(item(1, 'held'))).toEqual(['resume', 'stop']);
    expect(actionsFor(item(1, 'paused'))).toEqual(['stop']);
    expect(actionsFor(ghostItem(1, file('a.mov', 5), 'sending'))).toEqual(['remove']);
  });

  it('offers a retry only when one can help, and sending again only with the file in hand', () => {
    expect(actionsFor(item(1, 'failed', { failKey: 'error.network' }))).toEqual(['retry']);
    expect(actionsFor(item(1, 'failed', { failKey: 'error.notMedia' }))).toEqual([]);
    expect(actionsFor(item(1, 'failed', { failKey: 'error.tooLarge' }))).toEqual([]);
    expect(actionsFor(item(1, 'failed', { file: null }))).toEqual([]);
    expect(actionsFor(item(1, 'cancelled'))).toEqual(['again']);
    expect(actionsFor(item(1, 'cancelled', { file: null }))).toEqual([]);
    for (const state of ['received', 'importing', 'imported', 'duplicate', 'rejected']) {
      expect(actionsFor(item(1, state)), state).toEqual([]);
    }
  });
});

describe('the summary', () => {
  it('counts what arrived, what was not sent, and the bytes still to send from the phone', () => {
    const items = [
      item(1, 'imported'),
      item(2, 'duplicate'),
      item(3, 'sending', { sent: 400 }),
      item(4, 'waiting'),
      item(5, 'importing'),
      item(6, 'rejected'),
      item(7, 'cancelled'),
    ];
    expect(summarize(items)).toEqual({ total: 7, arrived: 2, notSent: 2, active: 3, onTheWay: 2, bytesLeft: 1_600 });
    expect(isActive(item(1, 'importing'))).toBe(true);
    expect(isActive(item(1, 'failed'))).toBe(false);
  });
});

describe('what a reload keeps', () => {
  it('keeps each row without its file, and asks for the file again where it was still on its way', () => {
    const before = [
      item(1, 'imported', { verdict: 'likely', uploadId: 'U1' }),
      item(2, 'sending', { sent: 300, uploadId: 'U2' }),
      item(3, 'failed', { failKey: 'error.network' }),
      item(4, 'cancelled', { cancelledBy: 'you' }),
    ];
    const snapshot = snapshotOf(before);
    expect(snapshot.map((entry: { state: string }) => entry.state)).toEqual(['imported', 'ghost', 'failed', 'cancelled']);
    expect(JSON.stringify(snapshot)).not.toContain('lastBytes');

    const after = restoreItems(JSON.parse(JSON.stringify(snapshot)), 10);
    expect(after.map((row: Item) => [row.id, row.state, row.file])).toEqual([
      [10, 'imported', null],
      [11, 'ghost', null],
      [12, 'failed', null],
      [13, 'cancelled', null],
    ]);
    expect(after[0].verdict).toBe('likely');
    expect(after[1].uploadId).toBe('U2');
    expect(after[3].cancelledBy).toBe('you');
  });

  it('drops anything malformed and caps the list', () => {
    expect(restoreItems('nope', 1)).toEqual([]);
    const restored = restoreItems([null, { name: '' , size: 1 }, { name: 'a.mov' }, { name: 'b.mov', size: 9, state: 'evil' }], 1);
    expect(restored.map((row: Item) => [row.record.name, row.state])).toEqual([['b.mov', 'ghost']]);
    const many = Array.from({ length: 600 }, (_, index) => ({ name: `f${index}.mov`, size: 1, state: 'imported' }));
    expect(restoreItems(many, 1)).toHaveLength(500);
  });

  it('puts a file picked again back into the row that was waiting for it', () => {
    const rows = restoreItems([{ name: 'a.mov', size: 5, state: 'sending' }, { name: 'b.mov', size: 7, state: 'imported' }], 1);
    expect(ghostFor(rows, file('a.mov', 5))).toBe(rows[0]);
    expect(ghostFor(rows, file('a.mov', 6))).toBeNull();
    expect(ghostFor(rows, file('b.mov', 7))).toBeNull();
  });

  it('reads the upload id from the end of a tus upload URL only', () => {
    expect(uploadIdFromUrl('http://192.168.1.4:4590/files/01JABCDEF')).toBe('01JABCDEF');
    expect(uploadIdFromUrl('/files/01JABCDEF/')).toBe('01JABCDEF');
    expect(uploadIdFromUrl('/elsewhere/01JABCDEF')).toBe('');
    expect(uploadIdFromUrl(null)).toBe('');
  });
});

describe("following the Mac's list", () => {
  it('follows the record of its own upload, not an older record of the same file', () => {
    const row = item(1, 'sending', { uploadId: '01B' });
    const files = [
      { id: '01A', name: row.record.name, sizeBytes: 1_000, state: 'cancelled' },
      { id: '01B', name: row.record.name, sizeBytes: 1_000, state: 'importing', receivedBytes: 1_000 },
    ];
    const { changed, halt, adopt } = applyRemote([row], files);
    expect(row.state).toBe('importing');
    expect(row.sent).toBe(1_000);
    expect([...changed]).toEqual([row]);
    expect(halt).toEqual([]);
    expect(adopt).toEqual([]);
  });

  it('lets a row without its file follow the newest record with its name and size', () => {
    const [ghost] = restoreItems([{ name: 'a.mov', size: 5, state: 'sending' }], 1);
    applyRemote([ghost], [
      { id: '01A', name: 'a.mov', sizeBytes: 5, state: 'failed' },
      { id: '01C', name: 'a.mov', sizeBytes: 5, state: 'imported' },
    ]);
    expect(ghost.state).toBe('imported');
    expect(ghost.uploadId).toBe('01C');
  });

  it("keeps a ghost waiting for its file while the Mac's copy is still partly sent", () => {
    const [ghost] = restoreItems([{ name: 'a.mov', size: 50, state: 'sending' }], 1);
    applyRemote([ghost], [{ id: '01A', name: 'a.mov', sizeBytes: 50, state: 'paused', receivedBytes: 20 }]);
    expect(ghost.state).toBe('ghost');
    expect(ghost.sent).toBe(20);
  });

  it('stops an upload the Mac refused or stopped, and says who stopped it', () => {
    const refused = item(1, 'sending', { uploadId: '01A' });
    const stopped = item(2, 'sending', { uploadId: '01B' });
    const { halt } = applyRemote([refused, stopped], [
      { id: '01A', name: refused.record.name, sizeBytes: 1_000, state: 'rejected', error: { code: 'transfer.not_media' } },
      { id: '01B', name: stopped.record.name, sizeBytes: 1_000, state: 'cancelled' },
    ]);
    expect(halt).toEqual([refused, stopped]);
    expect(refused.failKey).toBe('error.notMedia');
    expect(stopped.cancelledBy).toBe('mac');
  });

  it('does not let the Mac overwrite a file you stopped, and marks a likely smaller copy', () => {
    const yours = item(1, 'cancelled', { cancelledBy: 'you', uploadId: '01A' });
    const smaller = item(2, 'importing', { uploadId: '01B' });
    const { changed } = applyRemote([yours, smaller], [
      { id: '01A', name: yours.record.name, sizeBytes: 1_000, state: 'failed' },
      { id: '01B', name: smaller.record.name, sizeBytes: 1_000, state: 'importing', reencode: { verdict: 'likely' } },
    ]);
    expect(yours.state).toBe('cancelled');
    expect(smaller.verdict).toBe('likely');
    expect([...changed]).toEqual([smaller]);
  });

  it("brings back, once each, files the Mac knows that no row shows", () => {
    const { adopt } = applyRemote([], [
      { id: '01A', name: 'old.mov', sizeBytes: 5, state: 'failed' },
      { id: '01B', name: 'old.mov', sizeBytes: 5, state: 'imported', reencode: { verdict: 'likely' } },
      { id: '01C', name: 'half.mov', sizeBytes: 9, state: 'uploading', receivedBytes: 4 },
    ]);
    expect(adopt.map((remote: { id: string }) => remote.id)).toEqual(['01C', '01B']);
    const imported = adoptRemote(1, adopt[1]);
    expect([imported.state, imported.uploadId, imported.verdict]).toEqual(['imported', '01B', 'likely']);
    const half = adoptRemote(2, adopt[0]);
    expect([half.state, half.sent]).toEqual(['ghost', 4]);
    const cancelled = adoptRemote(3, { id: '01D', name: 'x.mov', sizeBytes: 1, state: 'cancelled' });
    expect(cancelled.cancelledBy).toBe('mac');
  });
});

describe('the reason under a row', () => {
  it('explains a pause, a missing file, a refusal and a smaller copy, and nothing else', () => {
    expect(reasonKeyFor(item(1, 'paused'))).toBe('reason.paused');
    expect(reasonKeyFor(ghostItem(1, file('a.mov', 1), 'waiting'))).toBe('reason.ghost');
    expect(reasonKeyFor(item(1, 'rejected', { failKey: 'error.notMedia' }))).toBe('error.notMedia');
    expect(reasonKeyFor(item(1, 'failed'))).toBe('error.generic');
    expect(reasonKeyFor(item(1, 'cancelled'))).toBe('');
    expect(reasonKeyFor(item(1, 'imported', { verdict: 'likely' }))).toBe('state.smallerCopy');
    expect(reasonKeyFor(item(1, 'sending', { verdict: 'likely' }))).toBe('');
    expect(reasonKeyFor(item(1, 'sending'))).toBe('');
  });
});
