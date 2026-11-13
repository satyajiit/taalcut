// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK: the clips added since a time and how many are searchable, which the gaps step waits on after "Add more
 * clips". Over the generated (made-up) library: audio isn't a clip, and a clip counts as ready once indexing marked
 * it searchable.
 */
import { describe, expect, it } from 'vitest';
import { clipsAddedSince } from '../../src/index';
import { searchFixture } from '../search/search-helpers';

describe('clipsAddedSince', () => {
  it('counts the clips added since a time, and the searchable ones among them', () => {
    const s = searchFixture();
    const ids = s.db.driver
      .prepare("SELECT id FROM assets WHERE kind = 'video' ORDER BY id LIMIT 3")
      .all()
      .map((r) => String(r.id));
    expect(ids).toHaveLength(3);
    const later = 9_000_000_000_000;
    expect(clipsAddedSince(s.db, later)).toEqual({ added: 0, ready: 0 });
    const mark = s.db.driver.prepare('UPDATE assets SET created_at = ? WHERE id = ?');
    for (const id of ids) mark.run(later + 1, id);
    s.db.driver.prepare('DELETE FROM asset_index_state WHERE asset_id IN (?, ?, ?)').run(...ids);
    expect(clipsAddedSince(s.db, later)).toEqual({ added: 3, ready: 0 });
    s.db.driver
      .prepare('INSERT INTO asset_index_state (asset_id, searchable_at, complete_at) VALUES (?, ?, NULL)')
      .run(ids[0]!, later + 5);
    expect(clipsAddedSince(s.db, later)).toEqual({ added: 3, ready: 1 });
  });
});
