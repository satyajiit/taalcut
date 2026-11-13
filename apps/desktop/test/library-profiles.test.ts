// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Casting's ShotProfileSource in the agent process: registered on core's
 * token, and its embeddings come from the active space once the jobs
 * process answers which one it is (asked again after a failure, not sooner
 * than 30 s).
 */
import { describe, expect, it } from 'vitest';
import {
  createContainer,
  ShotProfileSourceToken,
  unwrap,
  type EmbeddingSpace,
  type MainServicesClient,
} from '@taalcut/core';
import { openDatabase, sqliteVecPath } from '@taalcut/library';
import { AgentMainServicesToken, LibraryDatabaseToken } from '../src/shared/tokens';
import { activeSpaceIndex, registerLibraryProfiles } from '../src/utility/roots/library-profiles';

const SPACE: EmbeddingSpace = { model: 'test', revision: '1', dimensions: 4, indexName: 'test_space' };

function mainAnswering(space: () => Promise<EmbeddingSpace>) {
  const client = { embeddings: { space } } as unknown as MainServicesClient<'agent'>;
  return () => client;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the agent’s shot profiles', () => {
  it('registers a ShotProfileSource on core’s token', async () => {
    const db = unwrap(openDatabase({ path: ':memory:' }));
    const container = createContainer().value(LibraryDatabaseToken, db);
    registerLibraryProfiles(container);
    const source = container.resolve(ShotProfileSourceToken);
    expect(unwrap(await source.list({}, 10))).toEqual([]);
    db.close();
  });

  it('opens the active space’s index once main answers, and retries after 30 s', async () => {
    const db = unwrap(openDatabase({ path: ':memory:', extensions: [sqliteVecPath()] }));
    let now = 0;
    let calls = 0;
    let fail = true;
    const index = activeSpaceIndex(
      db,
      mainAnswering(async () => {
        calls += 1;
        if (fail) throw new Error('not served yet');
        return SPACE;
      }),
      () => now,
    );
    await settle();
    expect(calls).toBe(1);
    expect(index()).toBeNull();
    now = 10_000;
    index();
    expect(calls).toBe(1);
    fail = false;
    now = 31_000;
    index();
    await settle();
    expect(calls).toBe(2);
    expect(index()).not.toBeNull();

    const container = createContainer()
      .value(LibraryDatabaseToken, db)
      .value(
        AgentMainServicesToken,
        mainAnswering(async () => SPACE),
      );
    registerLibraryProfiles(container);
    expect(container.resolve(ShotProfileSourceToken)).toBeDefined();
    db.close();
  });
});
