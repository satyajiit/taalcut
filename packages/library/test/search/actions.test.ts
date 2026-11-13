// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-FIND: what people in a shot are doing, in the library. The migration's `shot_actions` and `shot_fts.actions`
 * follow each analysis (and nothing else: the labels keep what other triggers wrote); the action filter narrows
 * browse and search; `actionCounts` lists the filter's choices; a keyword search for "dance", "नाचते" or "khana
 * banate" finds the stored "dancing" and "cooking".
 */
import { unwrap, type AssetId, type ShotAnalysis, type ShotId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { filterSql, keywordList, type LibraryDatabase } from '../../src/index';
import { actionsOfWord } from '../../src/search/action-words';
import { shotActions } from '../../src/migrations/0036-shot-actions';
import { actionCounts } from '../../src/search/actions';
import { openTestDb } from '../helpers';
import { analysisFor, profileSetup, range24 } from '../repositories/profile-helpers';

/** A library of clips, one shot each, described with `text` and `actions`. */
function library(
  clips: readonly { text: string; actions?: string[]; objects?: string[] }[],
  db = openTestDb(),
) {
  const setup = profileSetup(db);
  const shots: ShotId[] = [];
  const assets: AssetId[] = [];
  for (const clip of clips) {
    const asset = setup.asset();
    const [shot] = unwrap(setup.repos.shots.replaceForAsset(asset, 0, [range24(0, 48)]));
    const base = analysisFor(range24(0, 48));
    const analysis: ShotAnalysis = {
      ...base,
      description: {
        ...base.description!,
        text: clip.text,
        objects: clip.objects ?? ['stage'],
        ...(clip.actions ? { actions: clip.actions } : {}),
      },
    };
    unwrap(setup.repos.shots.putAnalyses([{ shotId: shot!, analysis }]));
    shots.push(shot!);
    assets.push(asset);
  }
  return { ...setup, shots, assets };
}

const ftsRow = (db: LibraryDatabase, shot: ShotId) =>
  db.driver
    .prepare(
      `SELECT f.labels AS labels, f.actions AS actions FROM shot_fts f
       JOIN shot_search_rows r ON r.rowid = f.rowid WHERE r.shot_id = ?`,
    )
    .get(shot) as { labels: string; actions: string | null };

const storedActions = (db: LibraryDatabase, shot: ShotId) =>
  db.driver
    .prepare('SELECT action FROM shot_actions WHERE shot_id = ? ORDER BY action')
    .all(shot)
    .map((row) => row.action);

describe('shot actions in the library (migration shot_actions)', () => {
  it('keeps shot_actions and shot_fts.actions in step with the analysis, and the labels as they were', () => {
    const { db, repos, shots } = library([
      { text: 'Men dance on a stage.', actions: ['dancing', 'clapping'] },
    ]);
    const shot = shots[0]!;
    expect(storedActions(db, shot)).toEqual(['clapping', 'dancing']);
    expect(ftsRow(db, shot)).toEqual({ labels: 'stage beach wide', actions: 'dancing clapping' });

    // A description written again (vision.describe) replaces them; the labels follow the objects only.
    const model = { provider: 'test', model: 'vlm', local: true };
    unwrap(
      repos.shots.putDescriptions([
        {
          shotId: shot,
          description: { text: 'A man sings.', objects: ['microphone'], actions: ['singing'], model },
        },
      ]),
    );
    expect(storedActions(db, shot)).toEqual(['singing']);
    expect(ftsRow(db, shot)).toEqual({ labels: 'microphone', actions: 'singing' });

    // Without actions: none left anywhere.
    unwrap(
      repos.shots.putDescriptions([{ shotId: shot, description: { text: 'A stage.', objects: [], model } }]),
    );
    expect(storedActions(db, shot)).toEqual([]);
    expect(ftsRow(db, shot).actions).toBe('');
  });

  it('keeps place’s words in the labels and the actions in theirs, through every place trigger and a reindex', () => {
    const { db, repos, shots, assets } = library([
      { text: 'Men dance on a stage.', actions: ['dancing', 'clapping'] },
    ]);
    const [asset, shot] = [assets[0]!, shots[0]!];
    const place = (sql: string, ...params: string[]) => db.driver.prepare(sql).run(...params);
    const findsBy = (words: string) => keywordList(db, words, 5).map((match) => match.shotId);

    // A place stored (library.place): its words join the labels; the actions stay.
    place(
      `INSERT INTO asset_places (asset_id, basis, country, city_id, search_text, updated_at)
       VALUES (?, 'gps', 'PT', 2267057, 'Lisbon Lisboa Portugal', 1)`,
      asset,
    );
    expect(ftsRow(db, shot)).toEqual({
      labels: 'stage beach wide Lisbon Lisboa Portugal',
      actions: 'dancing clapping',
    });
    expect(findsBy('Lisbon')).toEqual([shot]);
    expect(findsBy('dance')).toEqual([shot]);

    // Its words changed.
    place(`UPDATE asset_places SET search_text = 'Porto Portugal' WHERE asset_id = ?`, asset);
    expect(ftsRow(db, shot)).toEqual({
      labels: 'stage beach wide Porto Portugal',
      actions: 'dancing clapping',
    });

    // The description written again: new objects and actions, the place's words kept.
    const model = { provider: 'test', model: 'vlm', local: true };
    unwrap(
      repos.shots.putDescriptions([
        {
          shotId: shot,
          description: { text: 'A man sings.', objects: ['microphone'], actions: ['singing'], model },
        },
      ]),
    );
    expect(ftsRow(db, shot)).toEqual({ labels: 'microphone Porto Portugal', actions: 'singing' });

    // The place gone: its words go, the actions stay.
    place('DELETE FROM asset_places WHERE asset_id = ?', asset);
    expect(ftsRow(db, shot)).toEqual({ labels: 'microphone', actions: 'singing' });

    // A reindex: the clip cut again. The new shot has the place's words at once, and its actions once described.
    place(
      `INSERT INTO asset_places (asset_id, basis, country, search_text, updated_at)
       VALUES (?, 'gps', 'PT', 'Lisbon Portugal', 1)`,
      asset,
    );
    const [fresh] = unwrap(repos.shots.replaceForAsset(asset, 1, [range24(12, 36)]));
    expect(ftsRow(db, fresh!).labels).toContain('Lisbon Portugal');
    expect(ftsRow(db, fresh!).actions).toBeNull();
    const base = analysisFor(range24(12, 36));
    unwrap(
      repos.shots.putAnalyses([
        {
          shotId: fresh!,
          analysis: { ...base, description: { ...base.description!, actions: ['dancing'] } },
        },
      ]),
    );
    expect(ftsRow(db, fresh!)).toEqual({ labels: 'sun sea beach wide Lisbon Portugal', actions: 'dancing' });
    expect(findsBy('Lisbon dancing')).toEqual([fresh]);
  });

  it('starts a reindexed shot without actions, and gives them back with its analysis', () => {
    const { db, repos, shots, assets } = library([{ text: 'Two girls dance.', actions: ['dancing'] }]);
    // Shots cut again at another start: the old one goes, a new one comes without an analysis.
    const [fresh] = unwrap(repos.shots.replaceForAsset(assets[0]!, 1, [range24(12, 36)]));
    expect(fresh).not.toBe(shots[0]);
    expect(storedActions(db, shots[0]!)).toEqual([]);
    expect(ftsRow(db, fresh!).actions).toBeNull();
    const base = analysisFor(range24(12, 36));
    unwrap(
      repos.shots.putAnalyses([
        {
          shotId: fresh!,
          analysis: { ...base, description: { ...base.description!, actions: ['dancing'] } },
        },
      ]),
    );
    expect(storedActions(db, fresh!)).toEqual(['dancing']);
    expect(ftsRow(db, fresh!)).toEqual({ labels: 'sun sea beach wide', actions: 'dancing' });
  });

  it('fills both from the analyses already stored, keeps every FTS row, and goes down and up again', () => {
    // The migration's own number, so a renumber at merge (it follows place's) needs no edit here.
    const ours = shotActions.version;
    const db = openTestDb({ targetVersion: ours - 1 });
    const setup = profileSetup(db);
    const asset = setup.asset();
    const shot = unwrap(setup.repos.shots.replaceForAsset(asset, 0, [range24(0, 48)]))[0]!;
    const base = analysisFor(range24(0, 48));
    // Written straight to the row, as a database before this migration holds whatever its analyses held.
    const analysis = { ...base, description: { ...base.description!, actions: ['cooking', 'chopping'] } };
    db.driver.prepare('UPDATE shots SET analysis = ? WHERE id = ?').run(JSON.stringify(analysis), shot);
    db.driver
      .prepare('UPDATE shots SET description = ?, objects = ? WHERE id = ?')
      .run('A cook.', 'pan', shot);
    const before = db.driver.prepare('SELECT rowid, description, labels FROM shot_fts').all();

    unwrap(db.migrateTo(ours));
    expect(storedActions(db, shot)).toEqual(['chopping', 'cooking']);
    expect(db.driver.prepare('SELECT rowid, description, labels FROM shot_fts').all()).toEqual(before);
    expect(ftsRow(db, shot).actions).toBe('cooking chopping');
    expect(keywordList(db, 'cooking', 5).map((m) => m.shotId)).toEqual([shot]);

    unwrap(db.migrateTo(ours - 1));
    expect(db.driver.prepare('SELECT rowid, description, labels FROM shot_fts').all()).toEqual(before);
    expect(
      db.driver.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'shot_actions%'`).get(),
    ).toEqual({ n: 0 });
    unwrap(db.migrateTo(ours));
    expect(storedActions(db, shot)).toEqual(['chopping', 'cooking']);
  });
});

describe('the action filter', () => {
  it('keeps the clips and shots showing any of the actions, and counts them for the filter', () => {
    const { db, repos, assets, shots } = library([
      { text: 'Men dance on a stage.', actions: ['dancing'] },
      { text: 'A couple dance and clap.', actions: ['dancing', 'clapping'] },
      { text: 'A man cooks.', actions: ['cooking'] },
      { text: 'A quiet lake.' },
    ]);
    const where = (actions: string[], level: 'asset' | 'shot') => {
      const sql = filterSql({ actions }, level);
      const from = level === 'asset' ? 'assets a' : 'shots s JOIN assets a ON a.id = s.asset_id';
      const column = level === 'asset' ? 'a.id' : 's.id';
      return db.driver
        .prepare(`SELECT ${column} AS id FROM ${from} WHERE ${sql.where} ORDER BY a.created_at, ${column}`)
        .all(...sql.params)
        .map((row) => row.id);
    };
    expect(new Set(where(['dancing'], 'asset'))).toEqual(new Set([assets[0], assets[1]]));
    expect(new Set(where(['cooking', 'clapping'], 'shot'))).toEqual(new Set([shots[1], shots[2]]));
    expect(where(['surfing'], 'asset')).toEqual([]);

    expect(unwrap(actionCounts(db))).toEqual([
      { action: 'dancing', assets: 2 },
      { action: 'clapping', assets: 1 },
      { action: 'cooking', assets: 1 },
    ]);
    // The trash is out of the choices, as out of the library.
    unwrap(repos.assets.trash([assets[0]!]));
    expect(unwrap(actionCounts(db))).toEqual([
      { action: 'clapping', assets: 1 },
      { action: 'cooking', assets: 1 },
      { action: 'dancing', assets: 1 },
    ]);
  });
});

describe('keyword search over actions', () => {
  it('finds the stored action from the words people type, in every language the app speaks', () => {
    const { db, shots } = library([
      { text: 'Men on a stage.', actions: ['dancing'] },
      { text: 'A woman at a stove.', actions: ['cooking'] },
      { text: 'Someone on a guitar.', actions: ['playing music'] },
    ]);
    const first = (query: string) => keywordList(db, query, 5)[0]?.shotId;
    for (const query of [
      'dance',
      'dances',
      'dancers',
      'नाचते हुए लोग',
      'dance wale shots',
      'gente bailando',
      'dançando',
    ])
      expect(first(query), query).toBe(shots[0]);
    for (const query of ['cooking', 'cook', 'खाना बनाते हुए', 'khana banate', 'cozinhando'])
      expect(first(query), query).toBe(shots[1]);
    expect(first('guitar')).toBe(shots[2]);
    expect(first('playing music')).toBe(shots[2]);
    // "हुए" and "wale" join the query but don't count against the shot's share of its words.
    expect(keywordList(db, 'नाचते हुए', 5)[0]?.similarity).toBe(1);
    expect(keywordList(db, 'dance wale', 5)[0]?.similarity).toBe(1);
  });

  it('ranks "dance shots" from the actions column alone, on a shot whose words never say dancing', () => {
    const { db, shots } = library([
      { text: 'A crowd on a lawn at dusk.', objects: ['lawn'] },
      { text: 'Men in matching shirts on a stage under lights.', objects: ['shirts'], actions: ['dancing'] },
    ]);
    const row = ftsRow(db, shots[1]!);
    expect(`${row.labels}`).not.toMatch(/danc/);
    const hits = keywordList(db, 'dance shots', 5);
    expect(hits.map((hit) => hit.shotId)).toEqual([shots[1]]);
    expect(hits[0]?.similarity).toBe(1);
    // bm25 weights the column: the match has a rank, and a column filter finds it there.
    const ranked = db.driver
      .prepare(
        `SELECT bm25(shot_fts, 1.0, 0.8, 1.2, 1.0, 0.5, 1.0) AS score FROM shot_fts WHERE shot_fts MATCH ?`,
      )
      .all('actions : "dancing"');
    expect(ranked).toHaveLength(1);
    expect(Number(ranked[0]!.score)).toBeLessThan(0);
  });

  it('reads a run of words as one action, and leaves words that mean none alone', () => {
    expect(actionsOfWord('playing the guitar')).toEqual(['playing music']);
    expect(actionsOfWord('khana banate')).toEqual(['cooking']);
    expect(actionsOfWord('Ran')).toEqual(['running']);
    expect(actionsOfWord('sunset')).toEqual([]);
  });
});
