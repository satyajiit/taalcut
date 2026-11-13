// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The fixture library with vectors and a search over it, for the search and tool tests. */
import { unwrap, type Embedder, type ShotId } from '@taalcut/core';
import {
  createLibrarySearch,
  createRepositories,
  openVectorIndex,
  sqliteVecPath,
  type LibrarySearchDeps,
} from '../../src/index';
import { createFakeEmbedder, FAKE_DIMENSIONS, FAKE_SPACE } from '../fixtures/fake-embedder';
import { buildFixtureLibrary } from '../fixtures/library-200';
import { openTestDb } from '../helpers';

export function searchFixture(
  options: { embedder?: Embedder | null; deps?: Partial<LibrarySearchDeps> } = {},
) {
  const db = openTestDb({ extensions: [sqliteVecPath()] });
  const vectors = unwrap(openVectorIndex(db, { name: FAKE_SPACE.indexName, dimensions: FAKE_DIMENSIONS }));
  const fixture = buildFixtureLibrary(db, { vectors });
  // `embedder` is the fake, to read its calls; the search may run with another (or none).
  const embedder = createFakeEmbedder();
  const active = options.embedder === undefined ? embedder : options.embedder;
  const search = createLibrarySearch({ db, vectors, embedder: active, ...options.deps });
  const repos = createRepositories(db);
  const themeOfShot = (shotId: ShotId) => {
    for (const [theme, shots] of fixture.shotsByTheme) if (shots.includes(shotId)) return theme;
    return undefined;
  };
  return { db, vectors, fixture, embedder, search, repos, themeOfShot };
}
