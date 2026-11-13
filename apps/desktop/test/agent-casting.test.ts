// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-KILL: casting's catalogue in the agent process reads the same vectors on its first read as on every later one.
 * A cast reads the newest shots (its hook's novelty) before it embeds its intents, and only embedding used to open
 * the space; so a process's first cast scored novelty against no vectors and the next against real ones, and a
 * recorded ask replayed as another cast after a restart (the make flow's render-kill journey).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createContainer,
  RationalTime,
  TimeRange,
  unwrap,
  type EmbeddingSpace,
  type MainServicesClient,
  type ShotId,
} from '@taalcut/core';
import {
  createRepositories,
  openDatabase,
  openVectorIndex,
  sqliteVecPath,
  type LibraryDatabase,
} from '@taalcut/library';
import { AgentMainServicesToken, LibraryDatabaseToken } from '../src/shared/tokens';
import { registerCasting, ShotCatalogToken } from '../src/utility/roots/agent-casting';

const SPACE: EmbeddingSpace = { model: 'test', revision: '1', dimensions: 4, indexName: 'test_space' };
const RATE = { num: 30, den: 1 };

/** Main as the agent sees it: the jobs process's embeddings, serving SPACE or not yet. */
function mainServing(serving: boolean): () => MainServicesClient<'agent'> {
  const embeddings = {
    space: async () => {
      if (!serving) throw new Error('not served yet');
      return SPACE;
    },
    embedTexts: async ({ texts }: { texts: readonly string[] }) => ({
      vectors: texts.map(() => [1, 0, 0, 0]),
    }),
  };
  const client = { embeddings } as unknown as MainServicesClient<'agent'>;
  return () => client;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** A library of three clips, each one shot with a frame vector in SPACE. */
function library(): { db: LibraryDatabase; shots: ShotId[] } {
  const db = unwrap(openDatabase({ path: ':memory:', extensions: [sqliteVecPath()] }));
  cleanups.push(() => db.close());
  const repos = createRepositories(db);
  const index = unwrap(openVectorIndex(db, { name: SPACE.indexName, dimensions: SPACE.dimensions }));
  const range = TimeRange.of(RationalTime.of(0, RATE), RationalTime.of(90, RATE));
  const shots = [0, 1, 2].map((n) => {
    const asset = unwrap(
      repos.assets.create({
        kind: 'video',
        sizeBytes: 1,
        originalFilename: `IMG_${n}.mov`,
        contentHash: String(n).repeat(64),
        captureTime: 1_000 + n,
      }),
    );
    const [shot] = unwrap(repos.shots.replaceForAsset(asset.id, 0, [range]));
    const vector = [0, 0, 0, 0];
    vector[n] = 1;
    unwrap(index.upsert([{ id: `frame:${shot}:0`, vector, metadata: { assetId: asset.id, kind: 'frame' } }]));
    return shot!;
  });
  return { db, shots };
}

function catalogOf(db: LibraryDatabase, serving: boolean) {
  const container = createContainer()
    .value(LibraryDatabaseToken, db)
    .value(AgentMainServicesToken, mainServing(serving));
  registerCasting(container);
  cleanups.push(() => void container.dispose());
  return container.resolve(ShotCatalogToken);
}

describe('casting’s catalogue in the agent', () => {
  it('reads the newest shots’ vectors on its first read, before any search opened the space', async () => {
    const { db } = library();
    const catalog = catalogOf(db, true);
    const first = unwrap(await catalog.recent(8));
    expect(first).toHaveLength(3);
    expect(unwrap(await catalog.recent(8))).toEqual(first);
  });

  it('gives a profile its vector on the first read', async () => {
    const { db, shots } = library();
    const catalog = catalogOf(db, true);
    const [profile] = unwrap(await catalog.profiles([{ assetId: '', shotId: shots[1]! }]));
    expect([...(profile?.embedding ?? [])]).toEqual([0, 1, 0, 0]);
  });

  it('reads profiles without vectors while the jobs process serves no space', async () => {
    const { db, shots } = library();
    const catalog = catalogOf(db, false);
    expect(unwrap(await catalog.recent(8))).toEqual([]);
    const [profile] = unwrap(await catalog.profiles([{ assetId: '', shotId: shots[0]! }]));
    expect(profile?.embedding).toHaveLength(0);
  });
});
